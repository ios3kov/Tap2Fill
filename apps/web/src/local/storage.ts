import { createStore, del, get, set } from "idb-keyval"

const DB_NAME = "tap2fill"
const STORE_NAME = "kv"

// Single store for the app. Simple, stable, and easy to migrate.
const store = createStore(DB_NAME, STORE_NAME)

export async function getJson<T>(key: string): Promise<T | null> {
  const v = await get(key, store)
  return (v as T) ?? null
}

export async function setJson<T>(key: string, value: T): Promise<void> {
  await set(key, value, store)
}

export async function delKey(key: string): Promise<void> {
  await del(key, store)
}
