/**
 * Coloring utilities (pure, safe, scalable)
 *
 * Responsibilities:
 * - Define palette (DEFAULT_PALETTE)
 * - Store fills as a simple map: { [regionId]: color }
 * - Apply fills to a mounted SVG container deterministically
 * - Provide adapters between FillMap and the canonical progress bytes format (Uint8Array)
 *   used by Stage 3+ (Undo/Reset/Completion) and future API sync.
 *
 * Design goals:
 * - No Telegram / network coupling
 * - No hit-test logic here (kept in svgTapToFill.ts)
 * - Fast DOM updates; safe selectors (CSS.escape)
 * - Defensive input handling for robustness
 */

import {
  UNPAINTED,
  createEmptyProgress,
  normalizeProgress,
  type ProgressBytes,
  type ProgressMeta,
} from "./progress/progress"

export type FillMap = Record<string, string>

/**
 * Default palette (safe CSS colors).
 * Keep this small initially; can be expanded per-page later.
 */
export const DEFAULT_PALETTE: readonly string[] = Object.freeze([
  "#FF4D4D", // red
  "#FFB020", // orange
  "#FFE04D", // yellow
  "#2ED573", // green
  "#1E90FF", // blue
  "#5352ED", // indigo
  "#A55EEA", // purple
  "#FFFFFF", // white
  "#2F3542", // near-black
])

const MAX_FILLMAP_ENTRIES = 20_000 // safety cap for accidental/untrusted payloads
const MAX_REGION_IDS = 50_000 // safety cap for conversion helpers

function toInt(n: unknown, fallback = 0): number {
  const x = typeof n === "number" ? n : Number(n)
  return Number.isFinite(x) ? Math.trunc(x) : fallback
}

function safeTrim(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

/**
 * Clamp palette index into the valid [0..palette.length-1] range.
 * If palette is empty (should never happen), returns 0.
 */
export function safeColorIndex(
  idx: unknown,
  palette: readonly string[] = DEFAULT_PALETTE,
): number {
  const len = palette.length
  if (len <= 0) return 0
  const i = toInt(idx, 0)
  if (i < 0) return 0
  if (i >= len) return len - 1
  return i
}

/**
 * Apply all fills to a container that already contains an SVG.
 *
 * Notes:
 * - Uses `CSS.escape` to avoid selector injection issues.
 * - Skips invalid keys/values.
 * - Only updates DOM when needed to reduce churn.
 */
export function applyFillsToContainer(host: HTMLElement, fills: FillMap): void {
  if (!host) return
  if (!fills || typeof fills !== "object") return

  const entries = Object.entries(fills)
  if (entries.length === 0) return

  let applied = 0

  for (const [regionIdRaw, colorRaw] of entries) {
    if (applied >= MAX_FILLMAP_ENTRIES) break

    const regionId = safeTrim(regionIdRaw)
    const color = safeTrim(colorRaw)

    if (!regionId || !color) continue

    const sel = `[data-region="${CSS.escape(regionId)}"]`
    const el = host.querySelector(sel)
    if (!el) continue

    const prev = el.getAttribute("fill") ?? ""
    if (prev === color) continue

    el.setAttribute("fill", color)
    applied++
  }
}

/**
 * Pure helper: return a new FillMap with (regionId -> color) applied.
 */
export function withFill(
  prev: FillMap,
  regionId: string,
  color: string,
): FillMap {
  const id = safeTrim(regionId)
  const c = safeTrim(color)
  if (!id || !c) return prev
  if (prev[id] === c) return prev
  return { ...prev, [id]: c }
}

/**
 * Pure helper: remove fill for a region (if present).
 */
export function withoutFill(prev: FillMap, regionId: string): FillMap {
  const id = safeTrim(regionId)
  if (!id) return prev
  if (!(id in prev)) return prev

  const next: FillMap = { ...prev }
  delete next[id]
  return next
}

/**
 * Build a stable regionId -> index mapping from an ordered regionIds list.
 * The regionIds order must match the SVG/asset contract used by content pipeline.
 */
export function buildRegionIndexMap(
  regionIds: readonly string[],
): Record<string, number> {
  const out: Record<string, number> = {}
  if (!Array.isArray(regionIds)) return out

  const limit = Math.min(regionIds.length, MAX_REGION_IDS)
  for (let i = 0; i < limit; i++) {
    const id = safeTrim(regionIds[i])
    if (!id) continue
    // First occurrence wins (stable).
    if (out[id] === undefined) out[id] = i
  }
  return out
}

function buildPaletteIndexMap(
  palette: readonly string[],
): Record<string, number> {
  const out: Record<string, number> = {}
  const limit = palette?.length ?? 0
  for (let i = 0; i < limit; i++) {
    const c = safeTrim(palette[i])
    if (!c) continue
    if (out[c] === undefined) out[c] = i
  }
  return out
}

/**
 * Adapter: FillMap -> canonical progress bytes (Uint8Array).
 *
 * - Unknown regionIds are ignored.
 * - Colors not present in palette are ignored.
 * - Output length equals regionIds.length.
 */
export function fillsToProgressBytes(
  fills: FillMap,
  regionIds: readonly string[],
  palette: readonly string[] = DEFAULT_PALETTE,
): ProgressBytes {
  const regionsCount = Array.isArray(regionIds)
    ? Math.min(regionIds.length, MAX_REGION_IDS)
    : 0
  const paletteLen = Array.isArray(palette) ? palette.length : 0

  const meta: ProgressMeta = { regionsCount, paletteLen }
  const base = createEmptyProgress(meta)
  if (base.length === 0) return base

  if (!fills || typeof fills !== "object") return base

  const regionIndex = buildRegionIndexMap(regionIds)
  const paletteIndex = buildPaletteIndexMap(palette)

  const entries = Object.entries(fills)
  let used = 0

  for (const [ridRaw, colorRaw] of entries) {
    if (used >= MAX_FILLMAP_ENTRIES) break

    const rid = safeTrim(ridRaw)
    const color = safeTrim(colorRaw)
    if (!rid || !color) continue

    const ri = regionIndex[rid]
    if (ri === undefined || ri < 0 || ri >= regionsCount) continue

    const ci = paletteIndex[color]
    if (ci === undefined || ci < 0 || ci >= paletteLen) continue

    base[ri] = ci
    used++
  }

  return base
}

/**
 * Adapter: canonical progress bytes (Uint8Array) -> FillMap.
 *
 * - Progress is normalized to meta (wrong length => empty).
 * - UNPAINTED entries are skipped.
 */
export function progressBytesToFills(
  progress: ProgressBytes | null | undefined,
  regionIds: readonly string[],
  palette: readonly string[] = DEFAULT_PALETTE,
): FillMap {
  const regionsCount = Array.isArray(regionIds)
    ? Math.min(regionIds.length, MAX_REGION_IDS)
    : 0
  const paletteLen = Array.isArray(palette) ? palette.length : 0

  const meta: ProgressMeta = { regionsCount, paletteLen }
  const cur = normalizeProgress(progress ?? null, meta)
  if (cur.length === 0) return {}

  const out: FillMap = {}
  for (let i = 0; i < cur.length; i++) {
    const v = cur[i]
    if (v === UNPAINTED) continue
    if (v >= paletteLen) continue

    const rid = safeTrim(regionIds[i])
    const color = safeTrim(palette[v])
    if (!rid || !color) continue

    out[rid] = color
  }

  return out
}
