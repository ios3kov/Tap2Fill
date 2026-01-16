// apps/web/src/app/coloring.ts

export type FillMap = Record<string, string>;

export const DEFAULT_PALETTE = [
  "#111827",
  "#ef4444",
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#a855f7",
] as const;

export function safeColorIndex(i: number): number {
  if (!Number.isFinite(i)) return 0;
  return Math.max(0, Math.min(DEFAULT_PALETTE.length - 1, Math.trunc(i)));
}

export function applyFillsToContainer(container: HTMLElement, fills: FillMap): void {
  for (const [rid, color] of Object.entries(fills)) {
    const node = container.querySelector(`[data-region="${CSS.escape(rid)}"]`);
    if (node) node.setAttribute("fill", color);
  }
}

export function setRegionFill(container: HTMLElement, regionId: string, color: string): void {
  const node = container.querySelector(`[data-region="${CSS.escape(regionId)}"]`);
  if (node) node.setAttribute("fill", color);
}