// apps/web/src/local/snapshotKv.ts
// Small IndexedDB KV store helper (typed, safe).
// Key points:
// - Do not use req.onabort: TS DOM typings do not define it on IDBRequest<T>.
// - Abort/error is handled on the transaction level.
// - Always close DB on versionchange.

export type KvStore = {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  del(key: string): Promise<void>;
};

function openDb(dbName: string, storeName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
    };

    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        try {
          db.close();
        } catch {
          // ignore
        }
      };
      resolve(db);
    };

    req.onerror = () => reject(req.error ?? new Error("IDB_OPEN_FAILED"));
  });
}

function withStore<T>(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);

    tx.onabort = () => reject(tx.error ?? new Error("IDB_TX_ABORTED"));
    tx.onerror = () => reject(tx.error ?? new Error("IDB_TX_FAILED"));

    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IDB_REQUEST_FAILED"));
  });
}

export function createKvStore(dbName: string, storeName: string): KvStore {
  let dbPromise: Promise<IDBDatabase> | null = null;

  const getDb = () => {
    if (!dbPromise) dbPromise = openDb(dbName, storeName);
    return dbPromise;
  };

  return {
    async get<T>(key: string) {
      const db = await getDb();
      const res = await withStore(db, storeName, "readonly", (s) => s.get(key));
      return (res ?? null) as T | null;
    },

    async set<T>(key: string, value: T) {
      const db = await getDb();
      await withStore(db, storeName, "readwrite", (s) => s.put(value as unknown, key));
    },

    async del(key: string) {
      const db = await getDb();
      await withStore(db, storeName, "readwrite", (s) => s.delete(key));
    },
  };
}