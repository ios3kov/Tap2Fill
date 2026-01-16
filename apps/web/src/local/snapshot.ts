// apps/web/src/local/snapshot.ts
import {
  PROGRESS_UNPAINTED,
  decodeBase64ToBytes,
  encodeBytesToBase64,
  makeEmptyProgressBytes,
  type PackOptions,
} from "../app/progress/pack"
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
 * Contract:
 * - Packed progress is the source of truth.
 * - `fills` is allowed as an optional debug/compat field, but we do NOT persist it
 *   to avoid duplication and storage bloat.
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

  // Undo (Stage 3): packed base64 history snapshots.
  undoStackB64: string[]
  undoBudgetUsed: number

  updatedAtMs: number
}

/**
 * Back-compat helper type:
 * Some intermediate builds might contain `undoStackJson`.
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

const UNPAINTED = PROGRESS_UNPAINTED
const MAX_UNDO_STACK = 64
const MAX_REGIONS = 20_000
const MAX_PALETTE_LEN = 64
const MAX_B64_LEN = 200_000

// Keep pack decoding strict, but enforce local caps as defense-in-depth.
const PACK_OPTS: PackOptions = {
  maxRegions: MAX_REGIONS,
  maxPaletteLen: MAX_PALETTE_LEN,
}

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

function pickUpdatedAtMs(v: unknown): number {
  return isFiniteNonNegativeInt(v) ? v : Date.now()
}

/**
 * Base64 length is deterministic for a given bytes length (with padding):
 * b64Len = 4 * ceil(n / 3)
 */
function expectedBase64LenForBytesLen(bytesLen: number): number {
  const n = clampInt(bytesLen, 0, MAX_REGIONS)
  return 4 * Math.ceil(n / 3)
}

function isLikelyBase64(s: string): boolean {
  // Fast structural checks only (no decoding).
  // - length multiple of 4
  // - allowed alphabet + optional padding
  // - bounded length
  if (!s) return false
  if (s.length > MAX_B64_LEN) return false
  if (s.length % 4 !== 0) return false
  return /^[A-Za-z0-9+/]+={0,2}$/.test(s)
}

function makeEmptyProgressB64(regionsCount: number): string {
  const rc = clampInt(regionsCount, 0, MAX_REGIONS)
  if (rc === 0) return "" // 0 bytes => empty base64
  const bytes = makeEmptyProgressBytes(rc, PACK_OPTS)
  return encodeBytesToBase64(bytes)
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

  // For a page with 0 regions, the only valid representation is empty.
  if (rc === 0) {
    return { progressB64: "", regionsCount: 0, paletteLen: pl }
  }

  const rawB64 = isNonEmptyString(params.progressB64)
    ? params.progressB64.trim()
    : ""

  // Cheap structural checks before decoding.
  if (!rawB64 || !isLikelyBase64(rawB64)) {
    return {
      progressB64: makeEmptyProgressB64(rc),
      regionsCount: rc,
      paletteLen: pl,
    }
  }

  const res = decodeBase64ToBytes(rawB64, rc, pl, PACK_OPTS)
  if (!res.ok) {
    return {
      progressB64: makeEmptyProgressB64(rc),
      regionsCount: rc,
      paletteLen: pl,
    }
  }

  // Canonicalize: decode -> encode (stabilizes padding/format).
  return {
    progressB64: encodeBytesToBase64(res.bytes),
    regionsCount: rc,
    paletteLen: pl,
  }
}

function sanitizeUndoStackB64(
  input: unknown,
  expectedB64Len: number,
): string[] {
  if (!Array.isArray(input)) return []

  const out: string[] = []
  for (const item of input) {
    if (out.length >= MAX_UNDO_STACK) break
    if (typeof item !== "string") continue

    const s = item.trim()
    if (!s) continue
    if (s.length > MAX_B64_LEN) continue

    // Fast validation: structure + exact expected base64 length for this page.
    // This avoids expensive decode loops at load time.
    if (s.length !== expectedB64Len) continue
    if (!isLikelyBase64(s)) continue

    out.push(s)
  }

  return out
}

/**
 * Reads undo stack from v2 snapshot.
 * Accepts legacy `undoStackJson` by treating it as `undoStackB64`.
 */
function readUndoStackCompat(
  snap: PageSnapshotV2Legacy,
  expectedB64Len: number,
): string[] {
  const canonical = sanitizeUndoStackB64(
    (snap as PageSnapshotV2).undoStackB64,
    expectedB64Len,
  )
  if (canonical.length > 0) return canonical

  return sanitizeUndoStackB64(snap.undoStackJson, expectedB64Len)
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

    progressB64: makeEmptyProgressB64(rc),
    regionsCount: rc,
    paletteLen: pl,

    undoStackB64: [],
    undoBudgetUsed: 0,

    updatedAtMs: pickUpdatedAtMs(snap.updatedAtMs),
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
    ? clampInt(snap.regionsCount, 0, MAX_REGIONS)
    : fallbackRc
  const plCandidate = isFiniteNonNegativeInt(snap.paletteLen)
    ? clampInt(snap.paletteLen, 0, MAX_PALETTE_LEN)
    : fallbackPl

  const p = sanitizeProgressB64({
    progressB64: snap.progressB64,
    regionsCount: rcCandidate,
    paletteLen: plCandidate,
  })

  const undoUsed = isFiniteNonNegativeInt(snap.undoBudgetUsed)
    ? clampInt(snap.undoBudgetUsed, 0, MAX_UNDO_STACK)
    : 0

  const expectedB64Len =
    p.regionsCount > 0 ? expectedBase64LenForBytesLen(p.regionsCount) : 0
  const undoStackB64 = readUndoStackCompat(snap, expectedB64Len)

  return {
    schemaVersion: 2,
    pageId,
    contentHash,
    clientRev: isFiniteNonNegativeInt(snap.clientRev) ? snap.clientRev : 0,
    demoCounter: isFiniteNonNegativeInt(snap.demoCounter)
      ? snap.demoCounter
      : 0,
    paletteIdx,

    // Keep if present (compat), but not used for correctness
    fills: snap.fills,

    progressB64: p.progressB64,
    regionsCount: p.regionsCount,
    paletteLen: p.paletteLen,

    undoStackB64: undoStackB64.slice(0, MAX_UNDO_STACK),
    undoBudgetUsed: undoUsed,

    updatedAtMs: pickUpdatedAtMs(snap.updatedAtMs),
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

  if (snap.schemaVersion === 2) {
    return normalizeV2(
      snap as PageSnapshotV2Legacy,
      pageId,
      contentHash,
      fallbackPaletteLen,
      fallbackRegionsCount,
    )
  }

  if (snap.schemaVersion === 1) {
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

  const expectedB64Len =
    p.regionsCount > 0 ? expectedBase64LenForBytesLen(p.regionsCount) : 0
  const undoStackB64 = sanitizeUndoStackB64(snap.undoStackB64, expectedB64Len)

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

    undoStackB64: undoStackB64.slice(0, MAX_UNDO_STACK),
    undoBudgetUsed: undoUsed,

    updatedAtMs: pickUpdatedAtMs(snap.updatedAtMs),
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
