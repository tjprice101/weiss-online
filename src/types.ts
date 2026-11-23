export interface CardMeta {
  id: string;
  name: string;
  hash: string;
  isClimax: boolean;
  /** Image is wider than tall (climax cards usually are). Rendered rotated in portrait slots. */
  landscape: boolean;
  createdAt: number;
  /** Library folder name; missing or empty means unfiled. */
  folder?: string;
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
  folder?: string;
}

export interface Store {
  kind: 'local';
  listCards(): Promise<CardMeta[]>;
  addCard(card: PreparedCard): Promise<CardMeta>;
  updateCard(id: string, patch: Partial<Pick<CardMeta, 'name' | 'isClimax' | 'folder'>>): Promise<void>;
  deleteCard(id: string): Promise<void>;
  getImageUrl(id: string): Promise<string>;
  getImageBlob(id: string): Promise<Blob>;
  /** Resolve metadata for a set of card ids. */
  getCardsByIds(ids: string[]): Promise<CardMeta[]>;
  listDecks(): Promise<Deck[]>;
  saveDeck(deck: Deck): Promise<Deck>;
  deleteDeck(id: string): Promise<void>;
}

export const DECK_SIZE = 50;
export const MAX_CLIMAX = 8;
export const MAX_COPIES = 4;

export function deckTotal(d: Deck): number {
  return d.cards.reduce((n, e) => n + e.count, 0);
}
