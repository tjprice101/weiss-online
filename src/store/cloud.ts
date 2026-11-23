import type { SupabaseClient } from '@supabase/supabase-js';
import type { CardMeta, Deck, PreparedCard, Store } from '../types';

interface CardRow {
  id: string;
  owner: string;
  hash: string;
  name: string;
  is_climax: boolean;
  landscape: boolean;
  path: string;
  created_at: string;
}
interface DeckRow {
  id: string;
  owner: string;
  name: string;
  cards: Deck['cards'];
  updated_at: string;
}

const BUCKET = 'cards';

/** Supabase-backed storage: cards table + public "cards" storage bucket + decks table. */
export class CloudStore implements Store {
  kind = 'cloud' as const;
  private rows = new Map<string, CardRow>();

  constructor(private sb: SupabaseClient, public uid: string) {}

  private toMeta(r: CardRow): CardMeta {
    this.rows.set(r.id, r);
    return {
      id: r.id,
      name: r.name,
      hash: r.hash,
      isClimax: r.is_climax,
      landscape: r.landscape,
      owner: r.owner,
      createdAt: Date.parse(r.created_at),
    };
  }

  async listCards() {
    const { data, error } = await this.sb.from('cards').select('*').eq('owner', this.uid).order('created_at');
    if (error) throw error;
    return (data as CardRow[]).map((r) => this.toMeta(r));
  }

  async listCommunityCards(query: string) {
    let q = this.sb.from('cards').select('*').neq('owner', this.uid).order('created_at', { ascending: false }).limit(300);
    if (query.trim()) q = q.ilike('name', `%${query.trim()}%`);
    const { data, error } = await q;
    if (error) throw error;
    return (data as CardRow[]).map((r) => this.toMeta(r));
  }

  async addCard(c: PreparedCard) {
    const { data: existing, error: e1 } = await this.sb
      .from('cards').select('*').eq('owner', this.uid).eq('hash', c.hash).maybeSingle();
    if (e1) throw e1;
    if (existing) return this.toMeta(existing as CardRow);
    const ext = (c.blob.type.split('/')[1] || 'img').replace('jpeg', 'jpg');
    const path = `${this.uid}/${c.hash}.${ext}`;
    const up = await this.sb.storage.from(BUCKET).upload(path, c.blob, { contentType: c.blob.type, upsert: true });
    if (up.error) throw up.error;
    const { data, error } = await this.sb
      .from('cards')
      .insert({ owner: this.uid, hash: c.hash, name: c.name, is_climax: c.isClimax, landscape: c.landscape, path })
      .select()
      .single();
    if (error) throw error;
    return this.toMeta(data as CardRow);
  }

  async updateCard(id: string, patch: Partial<Pick<CardMeta, 'name' | 'isClimax'>>) {
    const upd: Record<string, unknown> = {};
    if (patch.name !== undefined) upd.name = patch.name;
    if (patch.isClimax !== undefined) upd.is_climax = patch.isClimax;
    const { error } = await this.sb.from('cards').update(upd).eq('id', id);
    if (error) throw error;
    const r = this.rows.get(id);
    if (r) this.rows.set(id, { ...r, ...upd } as CardRow);
  }

  async deleteCard(id: string) {
    const row = await this.row(id);
    const { error } = await this.sb.from('cards').delete().eq('id', id);
    if (error) throw error;
    if (row) await this.sb.storage.from(BUCKET).remove([row.path]);
    this.rows.delete(id);
  }

  private async row(id: string): Promise<CardRow | undefined> {
    if (!this.rows.has(id)) await this.getCardsByIds([id]);
    return this.rows.get(id);
  }

  async getImageUrl(id: string) {
    const row = await this.row(id);
    if (!row) throw new Error('Card not found: ' + id);
    return this.sb.storage.from(BUCKET).getPublicUrl(row.path).data.publicUrl;
  }

  async getImageBlob(id: string) {
    const res = await fetch(await this.getImageUrl(id));
    if (!res.ok) throw new Error('Image download failed');
    return res.blob();
  }

  async getCardsByIds(ids: string[]) {
    const want = [...new Set(ids)];
    const missing = want.filter((id) => !this.rows.has(id));
    for (let i = 0; i < missing.length; i += 100) {
      const { data, error } = await this.sb.from('cards').select('*').in('id', missing.slice(i, i + 100));
      if (error) throw error;
      for (const r of data as CardRow[]) this.toMeta(r);
    }
    return want.filter((id) => this.rows.has(id)).map((id) => this.toMeta(this.rows.get(id)!));
  }

  async listDecks() {
    const { data, error } = await this.sb.from('decks').select('*').eq('owner', this.uid).order('updated_at', { ascending: false });
    if (error) throw error;
    return (data as DeckRow[]).map((r) => ({ id: r.id, name: r.name, cards: r.cards ?? [], updatedAt: Date.parse(r.updated_at) }));
  }

  async saveDeck(deck: Deck) {
    const now = new Date();
    const { error } = await this.sb
      .from('decks')
      .upsert({ id: deck.id, owner: this.uid, name: deck.name, cards: deck.cards, updated_at: now.toISOString() });
    if (error) throw error;
    return { ...deck, updatedAt: now.getTime() };
  }

  async deleteDeck(id: string) {
    const { error } = await this.sb.from('decks').delete().eq('id', id);
    if (error) throw error;
  }
}
