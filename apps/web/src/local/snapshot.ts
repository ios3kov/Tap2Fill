import { delKey, getJson, setJson } from "./storage";

export type PageId = string;
export type ContentHash = string;

export type PageSnapshotV1 = {
  schemaVersion: 1;
  pageId: PageId;
  contentHash: ContentHash;

  // Monotonic client revision. Increments on each local mutation.
  clientRev: number;

  // Demo payload (later: region colors, etc.)
  demoCounter: number;

  updatedAtMs: number;
};

export type LocalUserStateV1 = {
  schemaVersion: 1;
  lastPageId: PageId | null;
  updatedAtMs: number;
};

const KEY_PREFIX = "t2f:v1";
const KEY_LAST_PAGE = `${KEY_PREFIX}:user:lastPage`;

export function makePageKey(pageId: PageId, contentHash: ContentHash): string {
  // hash-based immutability aligns with CDN naming and avoids cross-version collisions
  return `${KEY_PREFIX}:page:${pageId}:hash:${contentHash}`;
}

export async function loadLastPageId(): Promise<PageId | null> {
  const s = await getJson<LocalUserStateV1>(KEY_LAST_PAGE);
  return s?.lastPageId ?? null;
}

export async function saveLastPageId(pageId: PageId | null): Promise<void> {
  const payload: LocalUserStateV1 = {
    schemaVersion: 1,
    lastPageId: pageId,
    updatedAtMs: Date.now(),
  };
  await setJson(KEY_LAST_PAGE, payload);
}

export async function loadPageSnapshot(
  pageId: PageId,
  contentHash: ContentHash,
): Promise<PageSnapshotV1 | null> {
  const key = makePageKey(pageId, contentHash);
  const snap = await getJson<PageSnapshotV1>(key);
  if (!snap) return null;

  // Guard against stale schema / wrong page.
  if (snap.schemaVersion !== 1) return null;
  if (snap.pageId !== pageId) return null;
  if (snap.contentHash !== contentHash) return null;

  return snap;
}

export async function savePageSnapshot(snap: PageSnapshotV1): Promise<void> {
  const key = makePageKey(snap.pageId, snap.contentHash);
  await setJson(key, snap);
}

export async function deletePageSnapshot(pageId: PageId, contentHash: ContentHash): Promise<void> {
  await delKey(makePageKey(pageId, contentHash));
}
