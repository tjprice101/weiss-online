export interface CardMeta {
  id: string;
  name: string;
  hash: string;
  isClimax: boolean;
  /** Image is wider than tall (climax cards usually are). Rendered rotated in portrait slots. */
  landscape: boolean;
  owner?: string;
  createdAt: number;
}

export interface DeckEntry {
  cardId: string;
  count: number;
}

export interface Deck {
  id: string;
  name: string;
  cards: DeckEntry[];
  updatedAt: number;
}

export interface PreparedCard {
  blob: Blob;
  name: string;
  hash: string;
  landscape: boolean;
  isClimax: boolean;
}

export interface Store {
  kind: 'local' | 'cloud';
  listCards(): Promise<CardMeta[]>;
  addCard(card: PreparedCard): Promise<CardMeta>;
  updateCard(id: string, patch: Partial<Pick<CardMeta, 'name' | 'isClimax'>>): Promise<void>;
  deleteCard(id: string): Promise<void>;
  getImageUrl(id: string): Promise<string>;
  getImageBlob(id: string): Promise<Blob>;
  /** Resolve metadata for any card ids (including community cards in cloud mode). */
  getCardsByIds(ids: string[]): Promise<CardMeta[]>;
  listDecks(): Promise<Deck[]>;
  saveDeck(deck: Deck): Promise<Deck>;
  deleteDeck(id: string): Promise<void>;
  listCommunityCards?(query: string): Promise<CardMeta[]>;
}

export const DECK_SIZE = 50;
export const MAX_CLIMAX = 8;
export const MAX_COPIES = 4;

export function deckTotal(d: Deck): number {
  return d.cards.reduce((n, e) => n + e.count, 0);
}
