// apps/web/src/local/db.ts
/**
 * IndexedDB bootstrap (single entry point) for Tap2Fill local-first storage.
 *
 * Goals:
 * - One place to open/own the DB connection.
 * - Stable key-value API (get/set/del) used by snapshot/outbox/etc.
 * - Safe defaults (namespace keys, JSON-only payloads, defensive fallbacks).
 * - Optional migrations, including one-time import from legacy localStorage keys.
 *
 * Design notes:
 * - We store JSON as strings to avoid structured-clone edge-cases and to keep payloads predictable.
 * - We use a single object store "kv" (out-of-line keys).
 * - If IndexedDB is unavailable (some webviews / privacy modes), we fall back to localStorage
 *   and then in-memory as the last resort, so the app remains functional.
 */

export type DbKey = string

export type DbDriver = {
  getRaw(key: DbKey): Promise<string | null>
  setRaw(key: DbKey, value: string): Promise<void>
  del(key: DbKey): Promise<void>
  clear(prefix?: string): Promise<void>
}

const DB_NAME = "tap2fill"
const DB_VERSION = 1
const STORE_KV = "kv"

// Keys used internally by this module
const META_IMPORTED_V1 = "__meta:imported_localstorage_v1"

// Legacy prefixes to import (if you previously stored snapshots in localStorage)
const LEGACY_PREFIXES: readonly string[] = ["t2f:v1:"]

/** Small helper to avoid locale surprises and accidental whitespace keys. */
function normKey(key: unknown): string {
  const s = typeof key === "string" ? key : ""
  return s.trim()
}

/** We only persist JSON-serializable data. */
function safeStringify(x: unknown): string {
  return JSON.stringify(x)
}

function safeParseJson<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T
  } catch {
    return null
  }
}

function hasIndexedDb(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null
  } catch {
    return false
  }
}

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage !== null
  } catch {
    return false
  }
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error("IDB_REQUEST_FAILED"))
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error("IDB_TX_ABORTED"))
    tx.onerror = () => reject(tx.error ?? new Error("IDB_TX_ERROR"))
  })
}

let dbPromise: Promise<IDBDatabase> | null = null

async function openDb(): Promise<IDBDatabase> {
  if (!hasIndexedDb()) throw new Error("IDB_UNAVAILABLE")

  const req = indexedDB.open(DB_NAME, DB_VERSION)

  req.onupgradeneeded = () => {
    const db = req.result

    // Create stores on first install. Future schema changes go here.
    if (!db.objectStoreNames.contains(STORE_KV)) {
      db.createObjectStore(STORE_KV)
    }
  }

  return reqToPromise(req)
}

async function getDb(): Promise<IDBDatabase> {
  if (!dbPromise) dbPromise = openDb()
  return dbPromise
}

async function idbGetRaw(key: DbKey): Promise<string | null> {
  const k = normKey(key)
  if (!k) return null

  const db = await getDb()
  const tx = db.transaction(STORE_KV, "readonly")
  const store = tx.objectStore(STORE_KV)
  const value = await reqToPromise(store.get(k))
  await txDone(tx)

  return typeof value === "string" ? value : null
}

async function idbSetRaw(key: DbKey, value: string): Promise<void> {
  const k = normKey(key)
  if (!k) return

  const v = String(value ?? "")
  const db = await getDb()
  const tx = db.transaction(STORE_KV, "readwrite")
  const store = tx.objectStore(STORE_KV)
  store.put(v, k)
  await txDone(tx)
}

async function idbDel(key: DbKey): Promise<void> {
  const k = normKey(key)
  if (!k) return

  const db = await getDb()
  const tx = db.transaction(STORE_KV, "readwrite")
  const store = tx.objectStore(STORE_KV)
  store.delete(k)
  await txDone(tx)
}

async function idbClear(prefix?: string): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(STORE_KV, "readwrite")
  const store = tx.objectStore(STORE_KV)

  const p = normKey(prefix)
  if (!p) {
    store.clear()
    await txDone(tx)
    return
  }

  // Prefix delete via cursor (bounded and deterministic).
  // Hard caps prevent runaway loops if storage is corrupted.
  const cursorReq = store.openCursor()
  let deleted = 0

  await new Promise<void>((resolve, reject) => {
    cursorReq.onerror = () =>
      reject(cursorReq.error ?? new Error("IDB_CURSOR_ERROR"))
    cursorReq.onsuccess = () => {
      const cur = cursorReq.result
      if (!cur) return resolve()

      const key = String(cur.key ?? "")
      if (key.startsWith(p)) {
        cur.delete()
        deleted++
        if (deleted > 50_000) return reject(new Error("IDB_CLEAR_PREFIX_CAP"))
      }
      cur.continue()
    }
  })

  await txDone(tx)
}

/**
 * localStorage driver (fallback). JSON stored as strings.
 * Note: localStorage is synchronous; we keep async interface for drop-in compatibility.
 */
const lsDriver: DbDriver = {
  async getRaw(key) {
    const k = normKey(key)
    if (!k || !hasLocalStorage()) return null
    try {
      const v = localStorage.getItem(k)
      return typeof v === "string" ? v : null
    } catch {
      return null
    }
  },
  async setRaw(key, value) {
    const k = normKey(key)
    if (!k || !hasLocalStorage()) return
    try {
      localStorage.setItem(k, String(value ?? ""))
    } catch {
      // ignore quota / denied
    }
  },
  async del(key) {
    const k = normKey(key)
    if (!k || !hasLocalStorage()) return
    try {
      localStorage.removeItem(k)
    } catch {
      // ignore
    }
  },
  async clear(prefix) {
    if (!hasLocalStorage()) return

    const p = normKey(prefix)
    try {
      if (!p) {
        localStorage.clear()
        return
      }
      // Remove only matching keys; stable iteration by index snapshot.
      const keys: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith(p)) keys.push(k)
      }
      for (const k of keys) localStorage.removeItem(k)
    } catch {
      // ignore
    }
  },
}

/** In-memory driver (last resort). */
function makeMemDriver(): DbDriver {
  const map = new Map<string, string>()
  return {
    async getRaw(key) {
      const k = normKey(key)
      return k ? (map.get(k) ?? null) : null
    },
    async setRaw(key, value) {
      const k = normKey(key)
      if (!k) return
      map.set(k, String(value ?? ""))
    },
    async del(key) {
      const k = normKey(key)
      if (!k) return
      map.delete(k)
    },
    async clear(prefix) {
      const p = normKey(prefix)
      if (!p) {
        map.clear()
        return
      }
      for (const k of Array.from(map.keys())) {
        if (k.startsWith(p)) map.delete(k)
      }
    },
  }
}

let driverPromise: Promise<DbDriver> | null = null

async function initDriver(): Promise<DbDriver> {
  // Prefer IndexedDB.
  if (hasIndexedDb()) {
    try {
      // Warm open to confirm availability.
      await getDb()
      return {
        getRaw: idbGetRaw,
        setRaw: idbSetRaw,
        del: idbDel,
        clear: idbClear,
      }
    } catch {
      // fall through
    }
  }

  // Fallback to localStorage if possible.
  if (hasLocalStorage()) return lsDriver

  // Last resort: memory.
  return makeMemDriver()
}

async function getDriver(): Promise<DbDriver> {
  if (!driverPromise) driverPromise = initDriver()
  return driverPromise
}

/**
 * One-time migration: import legacy localStorage keys into the current driver.
 * Safe to call multiple times; it is idempotent via META_IMPORTED_V1 marker.
 */
export async function migrateLegacyLocalStorageOnce(): Promise<void> {
  const d = await getDriver()

  // If we are already on localStorage driver, nothing to do.
  if (d === lsDriver) return

  const already = await d.getRaw(META_IMPORTED_V1)
  if (already === "1") return

  if (!hasLocalStorage()) {
    await d.setRaw(META_IMPORTED_V1, "1")
    return
  }

  // Snapshot keys first to avoid issues if storage mutates while iterating.
  const keys: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k) continue
      if (LEGACY_PREFIXES.some((p) => k.startsWith(p))) keys.push(k)
    }
  } catch {
    // If localStorage iteration fails, just mark and move on.
    await d.setRaw(META_IMPORTED_V1, "1")
    return
  }

  // Copy values; ignore failures (quota, access denied).
  for (const k of keys) {
    try {
      const v = localStorage.getItem(k)
      if (typeof v === "string") await d.setRaw(k, v)
    } catch {
      // ignore
    }
  }

  await d.setRaw(META_IMPORTED_V1, "1")
}

/**
 * Public API: JSON convenience methods (used by snapshot/outbox/etc.)
 * These mirror the existing storage helpers but use IndexedDB when available.
 */
export async function getJson<T>(key: DbKey): Promise<T | null> {
  const k = normKey(key)
  if (!k) return null

  const d = await getDriver()
  const raw = await d.getRaw(k)
  if (!raw) return null

  return safeParseJson<T>(raw)
}

export async function setJson(key: DbKey, value: unknown): Promise<void> {
  const k = normKey(key)
  if (!k) return

  const d = await getDriver()
  let raw = ""
  try {
    raw = safeStringify(value)
  } catch {
    // If stringify fails (circular), do not store corrupted data.
    return
  }
  await d.setRaw(k, raw)
}

export async function delKey(key: DbKey): Promise<void> {
  const k = normKey(key)
  if (!k) return

  const d = await getDriver()
  await d.del(k)
}

/**
 * Optional helper: clear all keys with prefix (handy for debug / tests).
 */
export async function clearPrefix(prefix: string): Promise<void> {
  const p = normKey(prefix)
  const d = await getDriver()
  await d.clear(p || undefined)
}

/**
 * Optional: expose the resolved driver kind for diagnostics.
 */
export async function getStorageBackend(): Promise<
  "indexeddb" | "localstorage" | "memory"
> {
  const d = await getDriver()
  if (d === lsDriver) return "localstorage"
  // Heuristic: IDB driver uses our functions
  if (d.getRaw === idbGetRaw) return "indexeddb"
  return "memory"
}
