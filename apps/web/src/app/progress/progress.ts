// apps/web/src/app/progress/progress.ts
/**
 * Domain progress logic (storage-format agnostic)
 *
 * This module operates on the canonical in-memory representation:
 *   Uint8Array length = regionsCount
 *   byte = palette index 0..paletteLen-1
 *   255 = UNPAINTED sentinel
 *
 * UI layer must not depend on how progress is stored (base64, FillMap, etc.).
 * Storage/transport conversions live in ./pack.ts (and later API adapters).
 */

export type ProgressBytes = Uint8Array

export type ProgressMeta = {
  regionsCount: number
  paletteLen: number
}

export type ApplyFillResult =
  | { ok: true; next: ProgressBytes; changed: boolean }
  | { ok: false; reason: string }

export const UNPAINTED = 255 as const

const DEFAULT_MAX_REGIONS = 20_000
const DEFAULT_MAX_PALETTE_LEN = 64

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

function validateMeta(
  meta: ProgressMeta,
): { ok: true } | { ok: false; reason: string } {
  if (!meta || typeof meta !== "object")
    return { ok: false, reason: "META_INVALID" }

  const rc = (meta as ProgressMeta).regionsCount
  const pl = (meta as ProgressMeta).paletteLen

  if (!isFiniteNonNegativeInt(rc) || rc > DEFAULT_MAX_REGIONS)
    return { ok: false, reason: "META_BAD_REGIONS_COUNT" }
  if (!isFiniteNonNegativeInt(pl) || pl > DEFAULT_MAX_PALETTE_LEN)
    return { ok: false, reason: "META_BAD_PALETTE_LEN" }

  return { ok: true }
}

/**
 * Create empty progress (all regions unpainted).
 */
export function createEmptyProgress(meta: ProgressMeta): ProgressBytes {
  const ok = validateMeta(meta)
  if (!ok.ok) return new Uint8Array(0)

  const bytes = new Uint8Array(meta.regionsCount)
  bytes.fill(UNPAINTED)
  return bytes
}

/**
 * Defensive normalization:
 * - If input length mismatches, returns a fresh empty progress with correct length.
 * - If values out of range, coerces them to UNPAINTED.
 */
export function normalizeProgress(
  progress: ProgressBytes | null | undefined,
  meta: ProgressMeta,
): ProgressBytes {
  const ok = validateMeta(meta)
  if (!ok.ok) return new Uint8Array(0)

  const rc = meta.regionsCount
  const pl = meta.paletteLen

  if (
    !progress ||
    !(progress instanceof Uint8Array) ||
    progress.length !== rc
  ) {
    return createEmptyProgress(meta)
  }

  // Copy-on-normalize only if needed; keep fast path for clean arrays.
  let dirty = false
  for (let i = 0; i < progress.length; i++) {
    const v = progress[i]
    if (v === UNPAINTED) continue
    if (v >= pl) {
      dirty = true
      break
    }
  }
  if (!dirty) return progress

  const next = new Uint8Array(progress)
  for (let i = 0; i < next.length; i++) {
    const v = next[i]
    if (v === UNPAINTED) continue
    if (v >= pl) next[i] = UNPAINTED
  }
  return next
}

/**
 * Apply fill at regionIndex with colorIndex.
 * - Immutable update: returns `next` (may be same reference if unchanged).
 * - Validates indices and meta strictly.
 */
export function applyFill(
  progress: ProgressBytes,
  regionIndex: number,
  colorIndex: number,
  meta: ProgressMeta,
): ApplyFillResult {
  const ok = validateMeta(meta)
  if (!ok.ok) return { ok: false, reason: ok.reason }

  const rc = meta.regionsCount
  const pl = meta.paletteLen

  const ri = clampInt(regionIndex, -1, rc) // allow -1 sentinel
  const ci = clampInt(colorIndex, -1, pl) // allow -1 sentinel

  if (ri < 0 || ri >= rc)
    return { ok: false, reason: "REGION_INDEX_OUT_OF_RANGE" }
  if (ci < 0 || ci >= pl)
    return { ok: false, reason: "COLOR_INDEX_OUT_OF_RANGE" }

  const cur = normalizeProgress(progress, meta)
  const prevVal = cur[ri]

  if (prevVal === ci) return { ok: true, next: cur, changed: false }

  const next = new Uint8Array(cur)
  next[ri] = ci
  return { ok: true, next, changed: true }
}

/**
 * Clear a region (set to UNPAINTED).
 */
export function clearRegion(
  progress: ProgressBytes,
  regionIndex: number,
  meta: ProgressMeta,
): ApplyFillResult {
  const ok = validateMeta(meta)
  if (!ok.ok) return { ok: false, reason: ok.reason }

  const rc = meta.regionsCount
  const ri = clampInt(regionIndex, -1, rc)

  if (ri < 0 || ri >= rc)
    return { ok: false, reason: "REGION_INDEX_OUT_OF_RANGE" }

  const cur = normalizeProgress(progress, meta)
  if (cur[ri] === UNPAINTED) return { ok: true, next: cur, changed: false }

  const next = new Uint8Array(cur)
  next[ri] = UNPAINTED
  return { ok: true, next, changed: true }
}

/**
 * Returns true if all regions are painted (none are UNPAINTED).
 */
export function isComplete(
  progress: ProgressBytes,
  meta: ProgressMeta,
): boolean {
  const ok = validateMeta(meta)
  if (!ok.ok) return false

  const cur = normalizeProgress(progress, meta)
  for (let i = 0; i < cur.length; i++) {
    if (cur[i] === UNPAINTED) return false
  }
  return true
}

/**
 * Painted/total percent in [0..100].
 * - For 0 regions, returns 0.
 */
export function progressPercent(
  progress: ProgressBytes,
  meta: ProgressMeta,
): number {
  const ok = validateMeta(meta)
  if (!ok.ok) return 0

  const cur = normalizeProgress(progress, meta)
  const total = cur.length
  if (total === 0) return 0

  let painted = 0
  for (let i = 0; i < total; i++) {
    const v = cur[i]
    if (v !== UNPAINTED) painted++
  }

  return (painted / total) * 100
}

/**
 * Convenience: returns { painted, total } counters (useful for UI).
 */
export function progressCounts(
  progress: ProgressBytes,
  meta: ProgressMeta,
): { painted: number; total: number } {
  const ok = validateMeta(meta)
  if (!ok.ok) return { painted: 0, total: 0 }

  const cur = normalizeProgress(progress, meta)
  const total = cur.length

  let painted = 0
  for (let i = 0; i < total; i++) {
    if (cur[i] !== UNPAINTED) painted++
  }

  return { painted, total }
}
