const DB_VERSION = 1;
export type StoreName = 'cards' | 'decks';

/** One open connection per database name (each profile has its own database). */
const conns = new Map<string, Promise<IDBDatabase>>();

function open(name: string): Promise<IDBDatabase> {
  let p = conns.get(name);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const req = indexedDB.open(name, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('cards')) d.createObjectStore('cards', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('decks')) d.createObjectStore('decks', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    conns.set(name, p);
  }
  return p;
}

export function closeDatabase(name: string) {
  conns.get(name)?.then((d) => d.close()).catch(() => {});
  conns.delete(name);
}

export function deleteDatabase(name: string): Promise<void> {
  closeDatabase(name);
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Typed access to one database. Bound to a name so in-flight work never leaks into another profile. */
export class Idb {
  constructor(readonly name: string) {}
  async all<T>(store: StoreName): Promise<T[]> {
    const d = await open(this.name);
    return wrap(d.transaction(store).objectStore(store).getAll()) as Promise<T[]>;
  }
  async get<T>(store: StoreName, key: string): Promise<T | undefined> {
    const d = await open(this.name);
    return wrap(d.transaction(store).objectStore(store).get(key)) as Promise<T | undefined>;
  }
  async put<T>(store: StoreName, value: T): Promise<void> {
    const d = await open(this.name);
    await wrap(d.transaction(store, 'readwrite').objectStore(store).put(value));
  }
  async del(store: StoreName, key: string): Promise<void> {
    const d = await open(this.name);
    await wrap(d.transaction(store, 'readwrite').objectStore(store).delete(key));
  }
}
