// apps/web/src/app/hitTest.ts

export type RegionHit = {
  el: Element;
  regionId: string;
};

function getAttr(el: Element, name: string): string | null {
  const v = el.getAttribute(name);
  if (!v) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/**
 * Hit-test hardening:
 *  - elementFromPoint(x,y)
 *  - climb parents until nearest [data-region]
 *  - ignore outline/decor
 */
export function hitTestRegion(clientX: number, clientY: number): RegionHit | null {
  const el = document.elementFromPoint(clientX, clientY) as Element | null;
  if (!el) return null;

  let cur: Element | null = el;
  for (let i = 0; i < 16 && cur; i++) {
    // ignore outline
    if (getAttr(cur, "data-role") === "outline") return null;

    const rid = getAttr(cur, "data-region");
    if (rid) return { el: cur, regionId: rid };

    cur = cur.parentElement;
  }
  return null;
}