import type { CardMeta, Deck, PreparedCard, Store } from '../types';
import { Idb } from '../util/idb';

interface CardRow extends CardMeta {
  blob: Blob;
}

const toMeta = (r: CardRow): CardMeta => ({
  id: r.id,
  name: r.name,
  hash: r.hash,
  isClimax: r.isClimax,
  landscape: r.landscape,
  createdAt: r.createdAt,
});

/** Browser-only storage (IndexedDB). Card id === sha256 of the original file. */
export class LocalStore implements Store {
  kind = 'local' as const;
  private urls = new Map<string, string>();
  private db: Idb;
  constructor(dbName: string) {
    this.db = new Idb(dbName);
  }

  /** Revoke every object URL this store handed out (call when switching profile). */
  dispose() {
    for (const u of this.urls.values()) URL.revokeObjectURL(u);
    this.urls.clear();
  }

  async listCards() {
    const rows = await this.db.all<CardRow>('cards');
    return rows.map(toMeta).sort((a, b) => a.createdAt - b.createdAt);
  }

  async addCard(c: PreparedCard) {
    const existing = await this.db.get<CardRow>('cards', c.hash);
    if (existing) return toMeta(existing);
    const row: CardRow = {
      id: c.hash,
      hash: c.hash,
      name: c.name,
      isClimax: c.isClimax,
      landscape: c.landscape,
      blob: c.blob,
      createdAt: Date.now(),
    };
    await this.db.put('cards', row);
    return toMeta(row);
  }

  async updateCard(id: string, patch: Partial<Pick<CardMeta, 'name' | 'isClimax'>>) {
    const row = await this.db.get<CardRow>('cards', id);
    if (!row) return;
    await this.db.put('cards', { ...row, ...patch });
  }

  async deleteCard(id: string) {
    await this.db.del('cards', id);
    const u = this.urls.get(id);
    if (u) URL.revokeObjectURL(u);
    this.urls.delete(id);
  }

  async getImageBlob(id: string) {
    const row = await this.db.get<CardRow>('cards', id);
    if (!row) throw new Error('Card image not found: ' + id);
    return row.blob;
  }

  async getImageUrl(id: string) {
    let u = this.urls.get(id);
    if (!u) {
      u = URL.createObjectURL(await this.getImageBlob(id));
      this.urls.set(id, u);
    }
    return u;
  }

  async getCardsByIds(ids: string[]) {
    const out: CardMeta[] = [];
    for (const id of new Set(ids)) {
      const r = await this.db.get<CardRow>('cards', id);
      if (r) out.push(toMeta(r));
    }
    return out;
  }

  async listDecks() {
    const decks = await this.db.all<Deck>('decks');
    return decks.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async saveDeck(deck: Deck) {
    const d = { ...deck, updatedAt: Date.now() };
    await this.db.put('decks', d);
    return d;
  }

  async deleteDeck(id: string) {
    await this.db.del('decks', id);
  }
}
