import { delKey, getJson, setJson } from "./storage";

export type PageId = string;
export type ContentHash = string;

/**
 * FillMap persisted in snapshots:
 * regionId -> fill color (string, typically hex).
 */
export type FillMapSnapshot = Record<string, string>;

export type PageSnapshotV1 = {
  schemaVersion: 1;
  pageId: PageId;
  contentHash: ContentHash;

  // Monotonic client revision. Increments on each local mutation.
  clientRev: number;

  // Demo payload (kept for now; can be removed later once progress schema is finalized).
  demoCounter: number;

  // Stage 2: local-only progress
  // Optional for backwards compatibility with older snapshots.
  fills?: FillMapSnapshot;
  paletteIdx?: number;

  updatedAtMs: number;
};

export type LocalUserStateV1 = {
  schemaVersion: 1;
  lastPageId: PageId | null;
  updatedAtMs: number;
};

const KEY_PREFIX = "t2f:v1";
const KEY_LAST_PAGE = `${KEY_PREFIX}:user:lastPage`;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isFiniteNonNegativeInt(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && Number.isInteger(v);
}

function sanitizeFillMap(input: unknown): FillMapSnapshot | undefined {
  if (!input || typeof input !== "object") return undefined;

  const out: FillMapSnapshot = {};
  const entries = Object.entries(input as Record<string, unknown>);

  // Hard cap to avoid storage bloat from accidental/untrusted values.
  const MAX_ENTRIES = 5000;

  let count = 0;
  for (const [k, v] of entries) {
    if (count >= MAX_ENTRIES) break;

    const key = typeof k === "string" ? k.trim() : "";
    const val = typeof v === "string" ? v.trim() : "";

    if (!key || !val) continue;

    // Lightweight sanity checks:
    // - region ids are usually like R001 but we don't hard-enforce here (contract is enforced at SVG layer).
    // - colors are strings; we don't hard-validate hex to keep palette extensible.
    out[key] = val;
    count++;
  }

  return Object.keys(out).length ? out : undefined;
}

export function makePageKey(pageId: PageId, contentHash: ContentHash): string {
  // hash-based immutability aligns with CDN naming and avoids cross-version collisions
  return `${KEY_PREFIX}:page:${pageId}:hash:${contentHash}`;
}

export async function loadLastPageId(): Promise<PageId | null> {
  const s = await getJson<LocalUserStateV1>(KEY_LAST_PAGE);
  const lp = s?.lastPageId ?? null;
  return isNonEmptyString(lp) ? lp : null;
}

export async function saveLastPageId(pageId: PageId | null): Promise<void> {
  const payload: LocalUserStateV1 = {
    schemaVersion: 1,
    lastPageId: pageId,
    updatedAtMs: Date.now(),
  };
  await setJson(KEY_LAST_PAGE, payload);
}

export async function loadPageSnapshot(pageId: PageId, contentHash: ContentHash): Promise<PageSnapshotV1 | null> {
  const key = makePageKey(pageId, contentHash);
  const snap = await getJson<PageSnapshotV1>(key);
  if (!snap) return null;

  // Guard against stale schema / wrong page.
  if (snap.schemaVersion !== 1) return null;
  if (snap.pageId !== pageId) return null;
  if (snap.contentHash !== contentHash) return null;

  // Defensive normalization (backward compatible).
  // If older snapshots lack fills/paletteIdx, we keep them undefined.
  const normalized: PageSnapshotV1 = {
    schemaVersion: 1,
    pageId: snap.pageId,
    contentHash: snap.contentHash,
    clientRev: isFiniteNonNegativeInt(snap.clientRev) ? snap.clientRev : 0,
    demoCounter: isFiniteNonNegativeInt(snap.demoCounter) ? snap.demoCounter : 0,
    fills: sanitizeFillMap((snap as PageSnapshotV1).fills),
    paletteIdx: isFiniteNonNegativeInt((snap as PageSnapshotV1).paletteIdx) ? (snap as PageSnapshotV1).paletteIdx : 0,
    updatedAtMs: isFiniteNonNegativeInt(snap.updatedAtMs) ? snap.updatedAtMs : Date.now(),
  };

  return normalized;
}

export async function savePageSnapshot(snap: PageSnapshotV1): Promise<void> {
  // Defensive: ensure we never persist obviously broken payloads.
  const safeSnap: PageSnapshotV1 = {
    ...snap,
    schemaVersion: 1,
    clientRev: isFiniteNonNegativeInt(snap.clientRev) ? snap.clientRev : 0,
    demoCounter: isFiniteNonNegativeInt(snap.demoCounter) ? snap.demoCounter : 0,
    fills: sanitizeFillMap(snap.fills),
    paletteIdx: isFiniteNonNegativeInt(snap.paletteIdx) ? snap.paletteIdx : 0,
    updatedAtMs: isFiniteNonNegativeInt(snap.updatedAtMs) ? snap.updatedAtMs : Date.now(),
  };

  const key = makePageKey(safeSnap.pageId, safeSnap.contentHash);
  await setJson(key, safeSnap);
}

export async function deletePageSnapshot(pageId: PageId, contentHash: ContentHash): Promise<void> {
  await delKey(makePageKey(pageId, contentHash));
}