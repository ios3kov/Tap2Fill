// apps/web/src/app/progress/pack.ts
/**
 * Progress packing utilities (Stage 3+)
 *
 * Goal:
 *  - Compact, strictly validated representation of page progress:
 *      FillMap <-> Uint8Array <-> base64
 *  - Future API contract alignment (Stage 6.2):
 *      Uint8Array length = regionsCount
 *      byte = palette index 0..paletteLen-1
 *      255 = UNPAINTED sentinel
 *
 * Correctness invariants (critical):
 *  - regionOrder and palette MUST be canonical and stable for a given contentHash.
 *  - If SVG or palette changes in a way that affects ordering or palette membership,
 *    you MUST change contentHash and store it as part of the snapshot key.
 *    Otherwise, old progress bytes will map to the wrong regions/colors.
 *
 * Performance:
 *  - compilePackContext(...) memoizes the heavy parts (normalized lists + index maps).
 *  - packFillMapToBytesWithContext(...) is optimized for the hot path:
 *      - avoids Object.entries allocation (uses for..in + hasOwnProperty)
 *
 * NOTE:
 *  - We intentionally avoid `any` here to preserve type-safety and satisfy eslint
 *    (`@typescript-eslint/no-explicit-any`). Runtime feature-detection is done via
 *    narrowing `unknown` for Buffer availability.
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
   * Maximum FillMap entries to process (defense-in-depth).
   * Default: 10k.
   */
  maxFillEntries?: number

  /**
   * When true, unknown region ids in fills are ignored.
   * When false, pack throws on unknown regions.
   * Default: true (resilient to minor content diffs).
   */
  ignoreUnknownRegions?: boolean

  /**
   * When true, colors not present in palette are ignored.
   * When false, pack throws on unknown colors.
   * Default: true.
   */
  ignoreUnknownColors?: boolean

  /**
   * Input contract mode for regionOrder / palette.
   *
   * - strictInputs=true (default):
   *   Does NOT reshape inputs. Validates:
   *    - array type
   *    - max length
   *    - non-empty items
   *    - uniqueness (unless allowDuplicate* is true)
   *   This is recommended for production correctness.
   *
   * - strictInputs=false:
   *   Trims, drops empty items, de-duplicates, and clamps to max caps.
   *   Useful for migration/testing, but can hide content issues.
   */
  strictInputs?: boolean

  /**
   * Allow duplicate region ids / palette colors in strict mode.
   * Default: false (duplicates are almost always a content bug).
   */
  allowDuplicateRegionIds?: boolean
  allowDuplicatePaletteColors?: boolean
}

export type PackedProgress = {
  regionsCount: number
  paletteLen: number
  progressB64: string
}

export type DecodeResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: string }

export type PackContext = {
  regions: readonly string[]
  palette: readonly string[]
  regionIndex: ReadonlyMap<string, number>
  colorIndex: ReadonlyMap<string, number>
  regionsCount: number
  paletteLen: number
  opts: Required<PackOptions>
}

/**
 * Non-throwing context compilation result (optional API).
 * Use this if you want to avoid try/catch in higher layers.
 */
export type CompileContextResult =
  | { ok: true; ctx: PackContext }
  | { ok: false; reason: string }

const UNPAINTED = 255

const DEFAULTS: Required<PackOptions> = {
  maxRegions: 20_000,
  maxPaletteLen: 64,
  maxFillEntries: 10_000,
  ignoreUnknownRegions: true,
  ignoreUnknownColors: true,
  strictInputs: true,
  allowDuplicateRegionIds: false,
  allowDuplicatePaletteColors: false,
}

/* --------------------------------- helpers -------------------------------- */

function mergeOptions(opts?: PackOptions): Required<PackOptions> {
  return { ...DEFAULTS, ...(opts ?? {}) }
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

function normalizeStrictList(params: {
  input: readonly unknown[]
  maxLen: number
  kind: "REGION" | "PALETTE"
  allowDuplicates: boolean
}): string[] {
  const { input, maxLen, kind, allowDuplicates } = params

  if (!Array.isArray(input)) throw new Error(`${kind}_INPUT_NOT_ARRAY`)
  if (input.length > maxLen)
    throw new Error(`${kind}_INPUT_TOO_LARGE:${input.length}>${maxLen}`)

  const out = new Array<string>(input.length)
  const seen = allowDuplicates ? null : new Set<string>()

  for (let i = 0; i < input.length; i++) {
    const s = typeof input[i] === "string" ? input[i].trim() : ""
    if (!s) throw new Error(`${kind}_EMPTY_ITEM_AT:${i}`)

    if (seen) {
      if (seen.has(s)) throw new Error(`${kind}_DUPLICATE_ITEM:${s}`)
      seen.add(s)
    }
    out[i] = s
  }

  return out
}

function normalizeCoerceList(params: {
  input: readonly unknown[]
  maxLen: number
}): string[] {
  const { input, maxLen } = params
  if (!Array.isArray(input) || input.length === 0) return []

  const out: string[] = []
  const seen = new Set<string>()
  const limit = Math.min(input.length, maxLen)

  for (let i = 0; i < limit; i++) {
    const s = typeof input[i] === "string" ? input[i].trim() : ""
    if (!s) continue
    if (seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }

  return out
}

function buildIndexMap(keys: readonly string[]): Map<string, number> {
  const m = new Map<string, number>()
  for (let i = 0; i < keys.length; i++) m.set(keys[i], i)
  return m
}

/**
 * Base64 encode/decode for raw bytes:
 * - Browser: btoa/atob
 * - Node-like runtimes: Buffer fallback (tests/tooling/SSR)
 */

type BufferLike = Uint8Array & { toString(encoding: "base64"): string }
type BufferCtorLike = {
  from(data: Uint8Array): BufferLike
  from(data: string, encoding: "base64"): Uint8Array
}

function getBufferCtor(): BufferCtorLike | null {
  const g = globalThis as unknown as { Buffer?: unknown }
  const B = g.Buffer

  // Node's Buffer is a callable with a static .from(...)
  if (!B || typeof B !== "function") return null

  const from = (B as { from?: unknown }).from
  if (typeof from !== "function") return null

  return B as unknown as BufferCtorLike
}

function bytesToBase64(bytes: Uint8Array): string {
  const BufferCtor = getBufferCtor()
  if (BufferCtor) return BufferCtor.from(bytes).toString("base64")

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

  const BufferCtor = getBufferCtor()
  if (BufferCtor) {
    try {
      const u8 = BufferCtor.from(s, "base64")
      return new Uint8Array(u8.buffer, u8.byteOffset, u8.byteLength)
    } catch {
      return null
    }
  }

  try {
    const bin = atob(s)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff
    return out
  } catch {
    return null
  }
}

function normalizeRegionOrder(
  regionOrder: readonly string[],
  opts: Required<PackOptions>,
): string[] {
  if (opts.strictInputs) {
    return normalizeStrictList({
      input: regionOrder as unknown as readonly unknown[],
      maxLen: opts.maxRegions,
      kind: "REGION",
      allowDuplicates: opts.allowDuplicateRegionIds,
    })
  }
  return normalizeCoerceList({
    input: regionOrder as unknown as readonly unknown[],
    maxLen: opts.maxRegions,
  })
}

function normalizePalette(
  palette: readonly string[],
  opts: Required<PackOptions>,
): string[] {
  if (opts.strictInputs) {
    return normalizeStrictList({
      input: palette as unknown as readonly unknown[],
      maxLen: opts.maxPaletteLen,
      kind: "PALETTE",
      allowDuplicates: opts.allowDuplicatePaletteColors,
    })
  }
  return normalizeCoerceList({
    input: palette as unknown as readonly unknown[],
    maxLen: opts.maxPaletteLen,
  })
}

/* ---------------------------------- API ---------------------------------- */

export const PROGRESS_UNPAINTED = UNPAINTED

/**
 * Compile canonical pack inputs into a reusable context.
 *
 * Throws on contract violations in strict mode.
 * If you prefer non-throwing behavior, use tryCompilePackContext(...).
 */
export function compilePackContext(
  regionOrder: readonly string[],
  palette: readonly string[],
  opts?: PackOptions,
): PackContext {
  const o = mergeOptions(opts)
  const regions = normalizeRegionOrder(regionOrder, o)
  const pal = normalizePalette(palette, o)

  if (o.strictInputs) {
    if (regions.length <= 0) throw new Error("REGION_EMPTY")
    if (pal.length <= 0) throw new Error("PALETTE_EMPTY")
  }

  const regionIndex = buildIndexMap(regions)
  const colorIndex = buildIndexMap(pal)

  return {
    regions,
    palette: pal,
    regionIndex,
    colorIndex,
    regionsCount: regions.length,
    paletteLen: pal.length,
    opts: o,
  }
}

/**
 * Non-throwing alternative to compilePackContext(...).
 * Useful if you want to avoid try/catch in callers.
 */
export function tryCompilePackContext(
  regionOrder: readonly string[],
  palette: readonly string[],
  opts?: PackOptions,
): CompileContextResult {
  try {
    return { ok: true, ctx: compilePackContext(regionOrder, palette, opts) }
  } catch (e: unknown) {
    const msg =
      e instanceof Error && typeof e.message === "string"
        ? e.message
        : "CTX_ERR"
    return { ok: false, reason: msg }
  }
}

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
 * Pack FillMap into bytes using a compiled context (fast path).
 *
 * Hot-path optimizations:
 * - avoids Object.entries(...) allocation
 * - uses for..in + hasOwnProperty
 * - respects maxFillEntries (defense-in-depth)
 */
export function packFillMapToBytesWithContext(
  fills: FillMap,
  ctx: PackContext,
): Uint8Array {
  const bytes = new Uint8Array(ctx.regionsCount)
  bytes.fill(UNPAINTED)

  if (!fills || typeof fills !== "object") return bytes

  const fillRecord = fills as Record<string, unknown>

  let processed = 0
  for (const ridRaw in fillRecord) {
    if (!Object.prototype.hasOwnProperty.call(fillRecord, ridRaw)) continue
    if (processed >= ctx.opts.maxFillEntries) break
    processed++

    const rid = typeof ridRaw === "string" ? ridRaw.trim() : ""
    const colorRaw = fillRecord[ridRaw]
    const color = typeof colorRaw === "string" ? colorRaw.trim() : ""

    if (!rid || !color) continue

    const rIdx = ctx.regionIndex.get(rid)
    if (rIdx === undefined) {
      if (ctx.opts.ignoreUnknownRegions) continue
      throw new Error(`PACK_UNKNOWN_REGION:${rid}`)
    }

    const cIdx = ctx.colorIndex.get(color)
    if (cIdx === undefined) {
      if (ctx.opts.ignoreUnknownColors) continue
      throw new Error(`PACK_UNKNOWN_COLOR:${color}`)
    }

    bytes[rIdx] = cIdx
  }

  return bytes
}

/**
 * Pack FillMap into bytes (compat path).
 * NOTE: Compiles context each call; prefer compilePackContext + fast path for frequent calls.
 */
export function packFillMapToBytes(
  fills: FillMap,
  regionOrder: readonly string[],
  palette: readonly string[],
  opts?: PackOptions,
): Uint8Array {
  const ctx = compilePackContext(regionOrder, palette, opts)
  return packFillMapToBytesWithContext(fills, ctx)
}

/**
 * Unpack bytes into FillMap using a compiled context (fast path).
 */
export function unpackBytesToFillMapWithContext(
  bytes: Uint8Array,
  ctx: PackContext,
): FillMap {
  const out: FillMap = {}
  const n = Math.min(bytes.length, ctx.regionsCount)

  for (let i = 0; i < n; i++) {
    const v = bytes[i]
    if (v === UNPAINTED) continue
    if (v >= ctx.paletteLen) continue

    const rid = ctx.regions[i]
    const color = ctx.palette[v]
    if (!rid || !color) continue

    out[rid] = color
  }

  return out
}

/**
 * Unpack bytes into FillMap (compat path).
 */
export function unpackBytesToFillMap(
  bytes: Uint8Array,
  regionOrder: readonly string[],
  palette: readonly string[],
  opts?: PackOptions,
): FillMap {
  const ctx = compilePackContext(regionOrder, palette, opts)
  return unpackBytesToFillMapWithContext(bytes, ctx)
}

/**
 * Encode progress bytes to base64 (raw bytes).
 */
export function encodeBytesToBase64(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
}

/**
 * Decode base64 to bytes and validate shape + ranges.
 *
 * IMPORTANT:
 * - Empty string is considered invalid (B64_EMPTY). If you need "blank page",
 *   store a real packed base64 created from makeEmptyProgressBytes(regionsCount).
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
  const ctx = compilePackContext(regionOrder, palette, opts)
  const bytes = packFillMapToBytesWithContext(fills, ctx)

  return {
    regionsCount: ctx.regionsCount,
    paletteLen: ctx.paletteLen,
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
  const ctx = compilePackContext(regionOrder, palette, opts)

  const rc = isFiniteNonNegativeInt(packed.regionsCount)
    ? packed.regionsCount
    : ctx.regionsCount
  const pl = isFiniteNonNegativeInt(packed.paletteLen)
    ? packed.paletteLen
    : ctx.paletteLen

  const res = decodeBase64ToBytes(packed.progressB64, rc, pl, ctx.opts)
  if (!res.ok) return {}

  // Prevent applying mismatched progress to a different region order.
  if (res.bytes.length !== ctx.regionsCount) return {}

  return unpackBytesToFillMapWithContext(res.bytes, ctx)
}

/**
 * Back-compat export for App.tsx:
 * decode packed progress (base64 bytes) directly into FillMap.
 */
export function decodeProgressB64ToFillMap(args: {
  progressB64: string
  regionsCount: number
  paletteLen: number
  regionOrder: readonly string[]
  palette: readonly string[]
  opts?: PackOptions
}): FillMap {
  const ctx = compilePackContext(args.regionOrder, args.palette, args.opts)
  const res = decodeBase64ToBytes(
    args.progressB64,
    args.regionsCount,
    args.paletteLen,
    ctx.opts,
  )
  if (!res.ok) return {}

  // Mismatch => treat as invalid snapshot (prevents shifted progress).
  if (res.bytes.length !== ctx.regionsCount) return {}

  return unpackBytesToFillMapWithContext(res.bytes, ctx)
}
