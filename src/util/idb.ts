const DB_NAME = 'weiss-online-mat';
const DB_VERSION = 1;
export type StoreName = 'cards' | 'decks';

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('cards')) d.createObjectStore('cards', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('decks')) d.createObjectStore('decks', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbAll<T>(store: StoreName): Promise<T[]> {
  const d = await db();
  return wrap(d.transaction(store).objectStore(store).getAll()) as Promise<T[]>;
}
export async function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  const d = await db();
  return wrap(d.transaction(store).objectStore(store).get(key)) as Promise<T | undefined>;
}
export async function idbPut<T>(store: StoreName, value: T): Promise<void> {
  const d = await db();
  await wrap(d.transaction(store, 'readwrite').objectStore(store).put(value));
}
export async function idbDel(store: StoreName, key: string): Promise<void> {
  const d = await db();
  await wrap(d.transaction(store, 'readwrite').objectStore(store).delete(key));
}
