// apps/web/src/app/progress/pack.ts
/**
 * Progress packing utilities (Stage 3+)
 *
 * Goal:
 *  - Provide a compact, strictly validated representation of page progress:
 *      FillMap <-> Uint8Array <-> base64
 *  - This matches the future API contract (Stage 6.2):
 *      Uint8Array length = regionsCount
 *      byte = palette index 0..paletteLen-1
 *      255 = UNPAINTED sentinel
 *
 * Design choices:
 *  - Does NOT assume any specific SVG format except stable region ids (e.g. R001).
 *  - Requires an explicit region order to avoid ambiguity:
 *      regionOrder[i] is the regionId mapped to progress byte i.
 *  - Strict bounds, caps, and defensive parsing (safe-by-default).
 */

export type RegionId = string

/**
 * FillMap used by UI layer.
 * - Key: regionId (e.g. "R001")
 * - Value: CSS color string (typically from palette array).
 */
export type FillMap = Record<RegionId, string>

export type PackOptions = {
  /**
   * Maximum regions allowed (defense-in-depth against accidental bloat).
   * Default: 20k (safe for typical SVG pages).
   */
  maxRegions?: number

  /**
   * Maximum palette length allowed (defense-in-depth).
   * Default: 64.
   */
  maxPaletteLen?: number

  /**
   * Maximum FillMap entries to process.
   * Default: 10k.
   */
  maxFillEntries?: number

  /**
   * When true, unknown region ids in fills are ignored.
   * When false, pack throws on unknown regions.
   * Default: true (more resilient to content updates).
   */
  ignoreUnknownRegions?: boolean

  /**
   * When true, colors not present in palette are ignored.
   * When false, pack throws on unknown colors.
   * Default: true.
   */
  ignoreUnknownColors?: boolean
}

export type PackedProgress = {
  regionsCount: number
  paletteLen: number
  progressB64: string
}

export type DecodeResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: string }

const UNPAINTED = 255

const DEFAULTS: Required<PackOptions> = {
  maxRegions: 20_000,
  maxPaletteLen: 64,
  maxFillEntries: 10_000,
  ignoreUnknownRegions: true,
  ignoreUnknownColors: true,
}

/* --------------------------------- helpers -------------------------------- */

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

function mergeOptions(opts?: PackOptions): Required<PackOptions> {
  return { ...DEFAULTS, ...(opts ?? {}) }
}

function normalizePalette(
  palette: readonly string[],
  maxPaletteLen: number,
): string[] {
  const out: string[] = []
  const seen = new Set<string>()

  const limit = Math.min(palette.length, maxPaletteLen)
  for (let i = 0; i < limit; i++) {
    const c = typeof palette[i] === "string" ? palette[i].trim() : ""
    if (!c) continue
    // Keep first occurrence. Palette order matters.
    if (seen.has(c)) continue
    seen.add(c)
    out.push(c)
  }
  return out
}

function normalizeRegionOrder(
  regionOrder: readonly string[],
  maxRegions: number,
): string[] {
  const out: string[] = []
  const seen = new Set<string>()

  const limit = Math.min(regionOrder.length, maxRegions)
  for (let i = 0; i < limit; i++) {
    const id = typeof regionOrder[i] === "string" ? regionOrder[i].trim() : ""
    if (!id) continue
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
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
  try {
    const bin = atob(s)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff
    return out
  } catch {
    return null
  }
}

function buildIndexMap(keys: readonly string[]): Map<string, number> {
  const m = new Map<string, number>()
  for (let i = 0; i < keys.length; i++) m.set(keys[i], i)
  return m
}

/* ---------------------------------- API ---------------------------------- */

/**
 * Create empty progress bytes (all UNPAINTED).
 */
export function makeEmptyProgressBytes(
  regionsCount: number,
  opts?: PackOptions,
): Uint8Array {
  const o = mergeOptions(opts)
  const rc = clampInt(regionsCount, 0, o.maxRegions)

  const bytes = new Uint8Array(rc)
  bytes.fill(UNPAINTED)
  return bytes
}

/**
 * Pack FillMap into bytes using:
 *  - regionOrder: defines index mapping
 *  - palette: defines color->index mapping
 *
 * Unknown regions/colors can be ignored (default) or rejected.
 */
export function packFillMapToBytes(
  fills: FillMap,
  regionOrder: readonly string[],
  palette: readonly string[],
  opts?: PackOptions,
): Uint8Array {
  const o = mergeOptions(opts)

  const regions = normalizeRegionOrder(regionOrder, o.maxRegions)
  const pal = normalizePalette(palette, o.maxPaletteLen)

  const regionIndex = buildIndexMap(regions)
  const colorIndex = buildIndexMap(pal)

  const bytes = new Uint8Array(regions.length)
  bytes.fill(UNPAINTED)

  if (!fills || typeof fills !== "object") return bytes

  const entries = Object.entries(fills as Record<string, unknown>)
  const limit = Math.min(entries.length, o.maxFillEntries)

  for (let i = 0; i < limit; i++) {
    const [ridRaw, colorRaw] = entries[i]

    const rid = typeof ridRaw === "string" ? ridRaw.trim() : ""
    const color = typeof colorRaw === "string" ? colorRaw.trim() : ""

    if (!rid || !color) continue

    const rIdx = regionIndex.get(rid)
    if (rIdx === undefined) {
      if (o.ignoreUnknownRegions) continue
      throw new Error(`PACK_UNKNOWN_REGION:${rid}`)
    }

    const cIdx = colorIndex.get(color)
    if (cIdx === undefined) {
      if (o.ignoreUnknownColors) continue
      throw new Error(`PACK_UNKNOWN_COLOR:${color}`)
    }

    bytes[rIdx] = cIdx
  }

  return bytes
}

/**
 * Unpack bytes into FillMap using:
 *  - regionOrder: defines index mapping
 *  - palette: defines index->color mapping
 *
 * Values:
 *  - 255 => unpainted (skipped)
 *  - 0..paletteLen-1 => palette index
 *
 * Invalid values are treated as unpainted.
 */
export function unpackBytesToFillMap(
  bytes: Uint8Array,
  regionOrder: readonly string[],
  palette: readonly string[],
  opts?: PackOptions,
): FillMap {
  const o = mergeOptions(opts)

  const regions = normalizeRegionOrder(regionOrder, o.maxRegions)
  const pal = normalizePalette(palette, o.maxPaletteLen)

  const out: FillMap = {}
  const n = Math.min(bytes.length, regions.length)

  for (let i = 0; i < n; i++) {
    const v = bytes[i]
    if (v === UNPAINTED) continue
    if (v >= pal.length) continue

    const rid = regions[i]
    const color = pal[v]
    if (!rid || !color) continue

    out[rid] = color
  }

  return out
}

/**
 * Encode progress bytes to base64 (raw bytes).
 */
export function encodeBytesToBase64(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
}

/**
 * Decode base64 to bytes and validate shape + ranges.
 */
export function decodeBase64ToBytes(
  progressB64: string,
  regionsCount: number,
  paletteLen: number,
  opts?: PackOptions,
): DecodeResult {
  const o = mergeOptions(opts)

  const rc = clampInt(regionsCount, 0, o.maxRegions)
  const pl = clampInt(paletteLen, 0, o.maxPaletteLen)

  if (!isNonEmptyString(progressB64)) return { ok: false, reason: "B64_EMPTY" }

  const bytes = base64ToBytes(progressB64)
  if (!bytes) return { ok: false, reason: "B64_DECODE_FAILED" }
  if (bytes.length !== rc) return { ok: false, reason: "B64_LENGTH_MISMATCH" }

  // Strict validation
  for (let i = 0; i < bytes.length; i++) {
    const v = bytes[i]
    if (v === UNPAINTED) continue
    if (v >= pl) return { ok: false, reason: "B64_VALUE_OUT_OF_RANGE" }
  }

  return { ok: true, bytes }
}

/**
 * High-level helper: FillMap -> PackedProgress (base64) using explicit order + palette.
 */
export function packFillMapToPackedProgress(
  fills: FillMap,
  regionOrder: readonly string[],
  palette: readonly string[],
  opts?: PackOptions,
): PackedProgress {
  const o = mergeOptions(opts)
  const regions = normalizeRegionOrder(regionOrder, o.maxRegions)
  const pal = normalizePalette(palette, o.maxPaletteLen)

  const bytes = packFillMapToBytes(fills, regions, pal, o)
  return {
    regionsCount: regions.length,
    paletteLen: pal.length,
    progressB64: bytesToBase64(bytes),
  }
}

/**
 * High-level helper: PackedProgress (base64) -> FillMap using explicit order + palette.
 * If decoding/validation fails, returns empty map.
 */
export function unpackPackedProgressToFillMap(
  packed: PackedProgress,
  regionOrder: readonly string[],
  palette: readonly string[],
  opts?: PackOptions,
): FillMap {
  const o = mergeOptions(opts)

  const regions = normalizeRegionOrder(regionOrder, o.maxRegions)
  const pal = normalizePalette(palette, o.maxPaletteLen)

  const rc = isFiniteNonNegativeInt(packed.regionsCount)
    ? packed.regionsCount
    : regions.length
  const pl = isFiniteNonNegativeInt(packed.paletteLen)
    ? packed.paletteLen
    : pal.length

  const res = decodeBase64ToBytes(packed.progressB64, rc, pl, o)
  if (!res.ok) return {}

  return unpackBytesToFillMap(res.bytes, regions, pal, o)
}

/**
 * Back-compat export for App.tsx (older integration):
 * decode packed progress (base64 bytes) directly into FillMap.
 *
 * This assumes:
 * - regionOrder is the canonical order used to pack the bytes
 * - palette is the canonical palette used to map indices -> CSS colors
 */
export function decodeProgressB64ToFillMap(args: {
  progressB64: string
  regionsCount: number
  paletteLen: number
  regionOrder: readonly string[]
  palette: readonly string[]
  opts?: PackOptions
}): FillMap {
  const res = decodeBase64ToBytes(
    args.progressB64,
    args.regionsCount,
    args.paletteLen,
    args.opts,
  )
  if (!res.ok) return {}
  return unpackBytesToFillMap(
    res.bytes,
    args.regionOrder,
    args.palette,
    args.opts,
  )
}

export const PROGRESS_UNPAINTED = UNPAINTED
