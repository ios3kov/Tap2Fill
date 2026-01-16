// apps/web/src/local/snapshot.ts
import { delKey, getJson, setJson } from "./storage"

export type PageId = string
export type ContentHash = string

export type PageSnapshotV1 = {
  schemaVersion: 1
  pageId: PageId
  contentHash: ContentHash
  clientRev: number
  demoCounter: number
  fills?: Record<string, string>
  paletteIdx?: number
  updatedAtMs: number
}

/**
 * Current snapshot (Stage 3+), aligned with App.tsx usage.
 *
 * NOTE:
 * - Packed progress is the source of truth.
 * - `fills` is allowed as an optional debug/compat field (so App.tsx can pass it),
 *   but we intentionally do not persist it to storage to avoid bloat/duplication.
 */
export type PageSnapshotV2 = {
  schemaVersion: 2
  pageId: PageId
  contentHash: ContentHash

  clientRev: number
  demoCounter: number
  paletteIdx: number

  // Optional debug/compat layer (not persisted by savePageSnapshot)
  fills?: Record<string, string>

  // Packed progress
  progressB64: string
  regionsCount: number
  paletteLen: number

  // Undo (Stage 3): stack items are base64 strings (historical packed progress snapshots),
  // budgeted by session.
  undoStackB64: string[]
  undoBudgetUsed: number

  updatedAtMs: number
}

/**
 * Back-compat helper type:
 * In some intermediate builds, storage might contain `undoStackJson`.
 * We accept it on read, but never persist it.
 */
type PageSnapshotV2Legacy = PageSnapshotV2 & {
  undoStackJson?: unknown
}

export type AnyPageSnapshot = PageSnapshotV1 | PageSnapshotV2Legacy

export type LocalUserStateV1 = {
  schemaVersion: 1
  lastPageId: PageId | null
  updatedAtMs: number
}

const KEY_PREFIX = "t2f:v2"
const KEY_LAST_PAGE = `${KEY_PREFIX}:user:lastPage`

const UNPAINTED = 255
const MAX_UNDO_STACK = 64
const MAX_REGIONS = 20_000
const MAX_PALETTE_LEN = 64
const MAX_B64_LEN = 200_000

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

  if (!bytes || bytes.length !== rc) {
    return {
      progressB64: makeEmptyProgressB64(rc),
      regionsCount: rc,
      paletteLen: pl,
    }
  }

  for (let i = 0; i < bytes.length; i++) {
    const v = bytes[i]
    if (v === UNPAINTED) continue
    if (pl === 0 || v >= pl) {
      return {
        progressB64: makeEmptyProgressB64(rc),
        regionsCount: rc,
        paletteLen: pl,
      }
    }
  }

  // normalize (trim -> decode -> encode) not needed; keep as canonical from bytes
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
    // We do not decode each item here (expensive); structural check is enough.
    // Full length check against progress happens in normalize/save.
    out.push(s)
  }
  return out
}

/**
 * Reads undo stack from v2 snapshot.
 * Accepts legacy `undoStackJson` (if it exists) by treating it as `undoStackB64`.
 */
function readUndoStackCompat(snap: PageSnapshotV2Legacy): string[] {
  const canonical = sanitizeUndoStackB64((snap as PageSnapshotV2).undoStackB64)
  if (canonical.length > 0) return canonical

  // legacy fallback
  const legacy = sanitizeUndoStackB64(
    (snap as PageSnapshotV2Legacy).undoStackJson,
  )
  return legacy
}

export function makePageKey(pageId: PageId, contentHash: ContentHash): string {
  return `${KEY_PREFIX}:page:${pageId}:hash:${contentHash}`
}

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

    // v1 fills intentionally dropped from persistence semantics; keep only optional in-memory if needed
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
  snap: PageSnapshotV2Legacy,
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

  const undoUsed = isFiniteNonNegativeInt(snap.undoBudgetUsed)
    ? clampInt(snap.undoBudgetUsed, 0, MAX_UNDO_STACK)
    : 0
  const undoStackB64 = readUndoStackCompat(snap)

  // Ensure undo snapshots match current progress length to avoid poisoning the undo stack.
  const progressLen = base64ToBytes(p.progressB64)?.length ?? 0
  const safeUndoStack =
    progressLen > 0
      ? undoStackB64.filter(
          (b) => (base64ToBytes(b)?.length ?? -1) === progressLen,
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

    // Keep if present (compat), but it's not used for correctness
    fills: snap.fills,

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

export async function loadPageSnapshot(
  pageId: PageId,
  contentHash: ContentHash,
  opts?: { regionsCount?: number; paletteLen?: number },
): Promise<PageSnapshotV2 | null> {
  const key = makePageKey(pageId, contentHash)
  const snap = await getJson<AnyPageSnapshot>(key)
  if (!snap) return null

  const fallbackRegionsCount = clampInt(opts?.regionsCount ?? 0, 0, MAX_REGIONS)
  const fallbackPaletteLen = clampInt(opts?.paletteLen ?? 0, 0, MAX_PALETTE_LEN)

  if ((snap as AnyPageSnapshot).schemaVersion === 2) {
    return normalizeV2(
      snap as PageSnapshotV2Legacy,
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

export async function savePageSnapshot(snap: PageSnapshotV2): Promise<void> {
  const paletteIdx = isFiniteNonNegativeInt(snap.paletteIdx)
    ? snap.paletteIdx
    : 0

  const p = sanitizeProgressB64({
    progressB64: snap.progressB64,
    regionsCount: snap.regionsCount,
    paletteLen: snap.paletteLen,
  })

  const undoUsed = isFiniteNonNegativeInt(snap.undoBudgetUsed)
    ? clampInt(snap.undoBudgetUsed, 0, MAX_UNDO_STACK)
    : 0
  const undoStackB64 = sanitizeUndoStackB64(snap.undoStackB64)

  // Filter undo stack by exact bytes length equality with current progress.
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

    // Intentionally do not persist fills to avoid bloat.
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

export const SNAPSHOT_UNPAINTED = UNPAINTED
export const SNAPSHOT_MAX_UNDO = MAX_UNDO_STACK
