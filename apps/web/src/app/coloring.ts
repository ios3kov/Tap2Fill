// apps/web/src/app/coloring.ts
/**
 * Stage 2 — Coloring utilities (pure, safe, scalable)
 *
 * Responsibilities:
 * - Define palette (DEFAULT_PALETTE)
 * - Store fills as a simple map: { [regionId]: color }
 * - Apply fills to a mounted SVG container deterministically
 *
 * Design goals:
 * - No Telegram / network coupling
 * - No hit-test logic here (kept in svgTapToFill.ts)
 * - Fast DOM updates; safe selectors (CSS.escape)
 * - Defensive input handling for robustness
 */

export type FillMap = Record<string, string>;

/**
 * Default palette (safe CSS colors).
 * Keep this small for Stage 2; can be expanded later.
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
]);

function toInt(n: unknown, fallback = 0): number {
  const x = typeof n === "number" ? n : Number(n);
  return Number.isFinite(x) ? Math.trunc(x) : fallback;
}

/**
 * Clamp palette index into the valid [0..palette.length-1] range.
 * If palette is empty (should never happen), returns 0.
 */
export function safeColorIndex(idx: unknown, palette: readonly string[] = DEFAULT_PALETTE): number {
  const len = palette.length;
  if (len <= 0) return 0;
  const i = toInt(idx, 0);
  if (i < 0) return 0;
  if (i >= len) return len - 1;
  return i;
}

function safeTrim(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Apply all fills to a container that already contains an SVG.
 *
 * Notes:
 * - Uses `CSS.escape` to avoid selector injection issues.
 * - Does not mutate the FillMap object.
 * - Skips invalid keys/values.
 * - Efficient for Stage 2 sizes; can be optimized later with caching if needed.
 */
export function applyFillsToContainer(host: HTMLElement, fills: FillMap): void {
  if (!host) return;
  if (!fills) return;

  const entries = Object.entries(fills);
  if (entries.length === 0) return;

  for (const [regionIdRaw, colorRaw] of entries) {
    const regionId = safeTrim(regionIdRaw);
    const color = safeTrim(colorRaw);

    if (!regionId || !color) continue;

    // data-region contract: stable ids (e.g. R001), but we don't enforce pattern here.
    const sel = `[data-region="${CSS.escape(regionId)}"]`;
    const el = host.querySelector(sel) as Element | null;
    if (!el) continue;

    // Only set when necessary to reduce DOM churn.
    const prev = el.getAttribute("fill") ?? "";
    if (prev === color) continue;

    el.setAttribute("fill", color);
  }
}

/**
 * Pure helper: return a new FillMap with (regionId -> color) applied.
 * Useful for reducers/state updates.
 */
export function withFill(prev: FillMap, regionId: string, color: string): FillMap {
  const id = safeTrim(regionId);
  const c = safeTrim(color);
  if (!id || !c) return prev;

  if (prev[id] === c) return prev;
  return { ...prev, [id]: c };
}

/**
 * Pure helper: remove fill for a region (if present).
 */
export function withoutFill(prev: FillMap, regionId: string): FillMap {
  const id = safeTrim(regionId);
  if (!id) return prev;
  if (!(id in prev)) return prev;

  const next: FillMap = { ...prev };
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete next[id];
  return next;
}