// apps/web/src/local/snapshotKv.ts
/**
 * Minimal IndexedDB KV store for local-first persistence.
 *
 * Design goals:
 * - Small surface area (kvGet/kvSet/kvDel).
 * - Robust error handling (never throws in normal flows).
 * - Strictly typed values (JSON-serializable objects).
 * - Stable schema and upgrade path.
 */

export type KvValue = unknown

const DB_NAME = "tap2fill_local"
const DB_VERSION = 1
const STORE_NAME = "kv"

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }

    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error("IDB_OPEN_FAILED"))
    // Some browsers expose abort on transaction, not on request; keep minimal.
    req.onblocked = () => {
      // If blocked, we still reject to make failures explicit for callers that want to handle it.
      reject(new Error("IDB_OPEN_BLOCKED"))
    }
  })

  return dbPromise
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error("IDB_TX_FAILED"))
    tx.onabort = () => reject(tx.error ?? new Error("IDB_TX_ABORTED"))
  })
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error("IDB_REQ_FAILED"))
  })
}

/**
 * Read by key. Returns null if missing or on failure.
 */
export async function kvGet<T = KvValue>(key: string): Promise<T | null> {
  try {
    const db = await openDb()
    const tx = db.transaction(STORE_NAME, "readonly")
    const store = tx.objectStore(STORE_NAME)
    const val = await reqToPromise(store.get(key))
    // Ensure transaction completes (best effort).
    await txDone(tx).catch(() => undefined)
    return (val ?? null) as T | null
  } catch {
    return null
  }
}

/**
 * Write by key. Returns true on success, false on failure.
 */
export async function kvSet(key: string, value: KvValue): Promise<boolean> {
  try {
    const db = await openDb()
    const tx = db.transaction(STORE_NAME, "readwrite")
    const store = tx.objectStore(STORE_NAME)
    store.put(value, key)
    await txDone(tx)
    return true
  } catch {
    return false
  }
}

/**
 * Delete by key. Returns true on success, false on failure.
 */
export async function kvDel(key: string): Promise<boolean> {
  try {
    const db = await openDb()
    const tx = db.transaction(STORE_NAME, "readwrite")
    const store = tx.objectStore(STORE_NAME)
    store.delete(key)
    await txDone(tx)
    return true
  } catch {
    return false
  }
}
