// apps/web/src/local/snapshot.ts
import { delKey, getJson, setJson } from "./storage"

export type PageId = string
export type ContentHash = string

/**
 * Legacy snapshot (Stage 2 / earlier).
 * Kept for backwards compatibility only.
 *
 * NOTE:
 * - We intentionally do NOT carry "fills" forward in v2 storage.
 * - Stage 3+ source of truth is packed progress (progressB64 + meta).
 */
export type PageSnapshotV1 = {
  schemaVersion: 1
  pageId: PageId
  contentHash: ContentHash

  clientRev: number
  demoCounter: number

  // legacy fields (ignored on upgrade):
  fills?: Record<string, string>
  paletteIdx?: number

  updatedAtMs: number
}

/**
 * Current snapshot (Stage 3+), aligned with App.tsx usage.
 *
 * Fields:
 * - progressB64: packed progress (forward compatible)
 * - regionsCount/paletteLen: strict meta for decoding/validation
 * - undoStackB64: stack of previous packed progress states (bounded)
 * - undoBudgetUsed: persisted for determinism across reloads
 */
export type PageSnapshotV2 = {
  schemaVersion: 2
  pageId: PageId
  contentHash: ContentHash

  clientRev: number
  demoCounter: number

  paletteIdx: number

  progressB64: string
  regionsCount: number
  paletteLen: number

  undoStackB64: string[]
  undoBudgetUsed: number

  updatedAtMs: number
}

export type AnyPageSnapshot = PageSnapshotV1 | PageSnapshotV2

export type LocalUserStateV1 = {
  schemaVersion: 1
  lastPageId: PageId | null
  updatedAtMs: number
}

const KEY_PREFIX = "t2f:v2"
const KEY_LAST_PAGE = `${KEY_PREFIX}:user:lastPage`

const UNPAINTED = 255 // sentinel for packed progress bytes
const MAX_UNDO_STACK = 64 // App.tsx uses 64 cap; keep consistent here
const MAX_REGIONS = 20_000
const MAX_PALETTE_LEN = 64
const MAX_B64_LEN = 200_000 // safety cap for payload size

/* ----------------------------- small validators ---------------------------- */

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0
}

function isFiniteNonNegativeInt(v: unknown): v is number {
  return (
    typeof v === "number" && Number.isFinite(v) && v >= 0 && Number.isInteger(v)
  )
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  const x = Math.trunc(n)
  return Math.max(min, Math.min(max, x))
}

/* -------------------------- Base64 pack/unpack ---------------------------- */
/**
 * We store progress as base64 of raw bytes (Uint8Array).
 * - Strict and compact
 * - Independent of Node Buffer
 */

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ""
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK)
    bin += String.fromCharCode(...slice)
  }
  return btoa(bin)
}

function base64ToBytes(b64: string): Uint8Array | null {
  const s = typeof b64 === "string" ? b64.trim() : ""
  if (!s) return null
  if (s.length > MAX_B64_LEN) return null

  try {
    const bin = atob(s)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff
    return out
  } catch {
    return null
  }
}

function makeEmptyProgressB64(regionsCount: number): string {
  const rc = clampInt(regionsCount, 0, MAX_REGIONS)
  const bytes = new Uint8Array(rc)
  bytes.fill(UNPAINTED)
  return bytesToBase64(bytes)
}

function sanitizeProgressB64(params: {
  progressB64: unknown
  regionsCount: unknown
  paletteLen: unknown
}): { progressB64: string; regionsCount: number; paletteLen: number } {
  const rc = isFiniteNonNegativeInt(params.regionsCount)
    ? clampInt(params.regionsCount, 0, MAX_REGIONS)
    : 0
  const pl = isFiniteNonNegativeInt(params.paletteLen)
    ? clampInt(params.paletteLen, 0, MAX_PALETTE_LEN)
    : 0

  const rawB64 = isNonEmptyString(params.progressB64)
    ? params.progressB64.trim()
    : ""
  const bytes = rawB64 ? base64ToBytes(rawB64) : null

  if (!bytes) {
    return {
      progressB64: makeEmptyProgressB64(rc),
      regionsCount: rc,
      paletteLen: pl,
    }
  }

  if (bytes.length !== rc) {
    return {
      progressB64: makeEmptyProgressB64(rc),
      regionsCount: rc,
      paletteLen: pl,
    }
  }

  // Validate each byte: UNPAINTED or < paletteLen
  for (let i = 0; i < bytes.length; i++) {
    const v = bytes[i]
    if (v === UNPAINTED) continue
    if (pl === 0) {
      return {
        progressB64: makeEmptyProgressB64(rc),
        regionsCount: rc,
        paletteLen: pl,
      }
    }
    if (v >= pl) {
      return {
        progressB64: makeEmptyProgressB64(rc),
        regionsCount: rc,
        paletteLen: pl,
      }
    }
  }

  // Canonicalize base64 (avoid alternative encodings)
  return { progressB64: bytesToBase64(bytes), regionsCount: rc, paletteLen: pl }
}

function sanitizeUndoStackB64(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const out: string[] = []
  for (const item of input) {
    if (out.length >= MAX_UNDO_STACK) break
    if (typeof item !== "string") continue
    const s = item.trim()
    if (!s) continue
    if (s.length > MAX_B64_LEN) continue
    out.push(s)
  }
  return out
}

/* ------------------------------- keying ---------------------------------- */

export function makePageKey(pageId: PageId, contentHash: ContentHash): string {
  return `${KEY_PREFIX}:page:${pageId}:hash:${contentHash}`
}

/* ----------------------------- lastPageId -------------------------------- */

export async function loadLastPageId(): Promise<PageId | null> {
  const s = await getJson<LocalUserStateV1>(KEY_LAST_PAGE)
  const lp = s?.lastPageId ?? null
  return isNonEmptyString(lp) ? lp : null
}

export async function saveLastPageId(pageId: PageId | null): Promise<void> {
  const payload: LocalUserStateV1 = {
    schemaVersion: 1,
    lastPageId: pageId,
    updatedAtMs: Date.now(),
  }
  await setJson(KEY_LAST_PAGE, payload)
}

/* ----------------------------- page snapshot ------------------------------ */

function normalizeV1(
  snap: PageSnapshotV1,
  pageId: PageId,
  contentHash: ContentHash,
  fallbackPaletteLen: number,
  fallbackRegionsCount: number,
): PageSnapshotV2 {
  const paletteIdx = isFiniteNonNegativeInt(snap.paletteIdx)
    ? snap.paletteIdx
    : 0

  // v1 -> v2: cannot safely pack legacy fills without a stable region-index mapping.
  // Keep deterministic empty packed progress with provided fallbacks.
  const rc = clampInt(fallbackRegionsCount, 0, MAX_REGIONS)
  const pl = clampInt(fallbackPaletteLen, 0, MAX_PALETTE_LEN)

  return {
    schemaVersion: 2,
    pageId,
    contentHash,
    clientRev: isFiniteNonNegativeInt(snap.clientRev) ? snap.clientRev : 0,
    demoCounter: isFiniteNonNegativeInt(snap.demoCounter)
      ? snap.demoCounter
      : 0,
    paletteIdx,

    progressB64: makeEmptyProgressB64(rc),
    regionsCount: rc,
    paletteLen: pl,

    undoStackB64: [],
    undoBudgetUsed: 0,

    updatedAtMs: isFiniteNonNegativeInt(snap.updatedAtMs)
      ? snap.updatedAtMs
      : Date.now(),
  }
}

function normalizeV2(
  snap: PageSnapshotV2,
  pageId: PageId,
  contentHash: ContentHash,
  fallbackPaletteLen: number,
  fallbackRegionsCount: number,
): PageSnapshotV2 | null {
  if (snap.pageId !== pageId) return null
  if (snap.contentHash !== contentHash) return null

  const paletteIdx = isFiniteNonNegativeInt(snap.paletteIdx)
    ? snap.paletteIdx
    : 0

  // Prefer stored meta; if invalid, use fallbacks.
  const fallbackRc = clampInt(fallbackRegionsCount, 0, MAX_REGIONS)
  const fallbackPl = clampInt(fallbackPaletteLen, 0, MAX_PALETTE_LEN)

  const rcCandidate = isFiniteNonNegativeInt(snap.regionsCount)
    ? snap.regionsCount
    : fallbackRc
  const plCandidate = isFiniteNonNegativeInt(snap.paletteLen)
    ? snap.paletteLen
    : fallbackPl

  const p = sanitizeProgressB64({
    progressB64: snap.progressB64,
    regionsCount: rcCandidate,
    paletteLen: plCandidate,
  })

  const undoStackB64 = sanitizeUndoStackB64(snap.undoStackB64)

  const undoUsed = isFiniteNonNegativeInt(snap.undoBudgetUsed)
    ? clampInt(snap.undoBudgetUsed, 0, MAX_UNDO_STACK)
    : 0

  // Keep only undo entries that match current progress length (cheap validation).
  const bytesLen = base64ToBytes(p.progressB64)?.length ?? 0
  const safeUndoStack =
    bytesLen > 0
      ? undoStackB64.filter(
          (b) => (base64ToBytes(b)?.length ?? -1) === bytesLen,
        )
      : []

  return {
    schemaVersion: 2,
    pageId,
    contentHash,
    clientRev: isFiniteNonNegativeInt(snap.clientRev) ? snap.clientRev : 0,
    demoCounter: isFiniteNonNegativeInt(snap.demoCounter)
      ? snap.demoCounter
      : 0,
    paletteIdx,

    progressB64: p.progressB64,
    regionsCount: p.regionsCount,
    paletteLen: p.paletteLen,

    undoStackB64: safeUndoStack.slice(0, MAX_UNDO_STACK),
    undoBudgetUsed: undoUsed,

    updatedAtMs: isFiniteNonNegativeInt(snap.updatedAtMs)
      ? snap.updatedAtMs
      : Date.now(),
  }
}

/**
 * Load a snapshot for a page.
 *
 * v2 is preferred. v1 is upgraded to v2 deterministically with safe defaults.
 */
export async function loadPageSnapshot(
  pageId: PageId,
  contentHash: ContentHash,
  opts?: {
    regionsCount?: number
    paletteLen?: number
  },
): Promise<PageSnapshotV2 | null> {
  const key = makePageKey(pageId, contentHash)
  const snap = await getJson<AnyPageSnapshot>(key)
  if (!snap) return null

  const fallbackRegionsCount = clampInt(opts?.regionsCount ?? 0, 0, MAX_REGIONS)
  const fallbackPaletteLen = clampInt(opts?.paletteLen ?? 0, 0, MAX_PALETTE_LEN)

  if ((snap as AnyPageSnapshot).schemaVersion === 2) {
    return normalizeV2(
      snap as PageSnapshotV2,
      pageId,
      contentHash,
      fallbackPaletteLen,
      fallbackRegionsCount,
    )
  }

  if ((snap as AnyPageSnapshot).schemaVersion === 1) {
    const v1 = snap as PageSnapshotV1
    if (v1.pageId !== pageId) return null
    if (v1.contentHash !== contentHash) return null

    return normalizeV1(
      v1,
      pageId,
      contentHash,
      fallbackPaletteLen,
      fallbackRegionsCount,
    )
  }

  return null
}

/**
 * Save snapshot v2.
 * Persist only v2; v1 is legacy and should not be re-emitted.
 */
export async function savePageSnapshot(snap: PageSnapshotV2): Promise<void> {
  const paletteIdx = isFiniteNonNegativeInt(snap.paletteIdx)
    ? snap.paletteIdx
    : 0

  const p = sanitizeProgressB64({
    progressB64: snap.progressB64,
    regionsCount: snap.regionsCount,
    paletteLen: snap.paletteLen,
  })

  const undoStackB64 = sanitizeUndoStackB64(snap.undoStackB64)

  const undoUsed = isFiniteNonNegativeInt(snap.undoBudgetUsed)
    ? clampInt(snap.undoBudgetUsed, 0, MAX_UNDO_STACK)
    : 0

  const progressLen = base64ToBytes(p.progressB64)?.length ?? 0
  const safeUndoStack =
    progressLen > 0
      ? undoStackB64.filter(
          (b) => (base64ToBytes(b)?.length ?? -1) === progressLen,
        )
      : []

  const safe: PageSnapshotV2 = {
    schemaVersion: 2,
    pageId: snap.pageId,
    contentHash: snap.contentHash,
    clientRev: isFiniteNonNegativeInt(snap.clientRev) ? snap.clientRev : 0,
    demoCounter: isFiniteNonNegativeInt(snap.demoCounter)
      ? snap.demoCounter
      : 0,
    paletteIdx,

    progressB64: p.progressB64,
    regionsCount: p.regionsCount,
    paletteLen: p.paletteLen,

    undoStackB64: safeUndoStack.slice(0, MAX_UNDO_STACK),
    undoBudgetUsed: undoUsed,

    updatedAtMs: isFiniteNonNegativeInt(snap.updatedAtMs)
      ? snap.updatedAtMs
      : Date.now(),
  }

  const key = makePageKey(safe.pageId, safe.contentHash)
  await setJson(key, safe)
}

export async function deletePageSnapshot(
  pageId: PageId,
  contentHash: ContentHash,
): Promise<void> {
  await delKey(makePageKey(pageId, contentHash))
}

/* ---------------------- convenience exports for UI ------------------------ */

export const SNAPSHOT_UNPAINTED = UNPAINTED
export const SNAPSHOT_MAX_UNDO = MAX_UNDO_STACK
