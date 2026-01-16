// apps/web/src/app/svgTapToFill.ts
/**
 * Stage 2 — SVG Tap-to-Fill utilities (refactored, strict, safe)
 *
 * Contract goals:
 * - SVG must have viewBox
 * - clickable regions: data-region="R###" (configurable pattern)
 * - decoration/outline: data-role="outline" (no pointer events)
 *
 * Hit-test hardening:
 * - document.elementFromPoint(x,y) -> climb parents -> nearest [data-region]
 *
 * Security:
 * - Parses via DOMParser (image/svg+xml), not by injecting untrusted HTML
 * - Defense-in-depth sanitizer:
 *    - removes <script> and <foreignObject>
 *    - strips on* handler attributes
 *    - strips javascript: in href/xlink:href
 *
 * Notes:
 * - Best practice is to treat SVG assets as trusted build artifacts.
 * - This module stays safe even if an SVG is accidentally replaced/tainted.
 */

export type SvgTapToFillMountOptions = {
  /**
   * Set on <svg> to enforce pointer-events policy via CSS:
   * [data-page-root] { pointer-events:none } + regions enabled.
   */
  rootAttrName?: string // default: "data-page-root"
  rootAttrValue?: string // default: "1"

  /**
   * Selector of non-interactive decoration/outline elements.
   * Must not intercept pointer events.
   */
  outlineSelector?: string // default: "[data-role='outline']"

  /**
   * Region selector. Required for contract verification.
   * Regions should have stable ids: data-region="R###" (recommended).
   */
  regionSelector?: string // default: "[data-region]"

  /**
   * Enforce that <svg> has viewBox.
   */
  requireViewBox?: boolean // default: true

  /**
   * Optional stricter contract: validate region id format.
   */
  requireRegionIdPattern?: boolean // default: true
  regionIdPattern?: RegExp // default: /^R\d{3}$/

  /**
   * Defense-in-depth SVG sanitization (recommended true).
   */
  sanitize?: boolean // default: true
}

export type HitTestResult = {
  regionId: string
  element: Element
}

export type MountResult =
  | { ok: true; svg: SVGSVGElement }
  | { ok: false; reason: string }

const DEFAULT_OPTS: Required<SvgTapToFillMountOptions> = {
  rootAttrName: "data-page-root",
  rootAttrValue: "1",
  outlineSelector: "[data-role='outline']",
  regionSelector: "[data-region]",
  requireViewBox: true,
  requireRegionIdPattern: true,
  regionIdPattern: /^R\d{3}$/,
  sanitize: true,
}

function mergeOptions(
  opts?: SvgTapToFillMountOptions,
): Required<SvgTapToFillMountOptions> {
  return { ...DEFAULT_OPTS, ...(opts ?? {}) }
}

function safeTrim(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

function toLowerAscii(s: string): string {
  // Avoid locale surprises.
  return s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32))
}

function serializeSvgElement(svg: SVGSVGElement): string {
  return new XMLSerializer().serializeToString(svg)
}

/**
 * Minimal, fast SVG sanitizer:
 * - removes <script> and <foreignObject>
 * - strips on* event handler attributes
 * - strips javascript: URLs in href/xlink:href
 */
export function sanitizeSvgText(svgText: string): string {
  const raw = safeTrim(svgText)
  if (!raw) return ""

  const doc = new DOMParser().parseFromString(raw, "image/svg+xml")
  const svg = doc.querySelector("svg") as SVGSVGElement | null
  if (!svg) return ""

  // Remove high-risk nodes.
  doc.querySelectorAll("script, foreignObject").forEach((el) => el.remove())

  // Strip event handlers and javascript: hrefs.
  const walker = doc.createTreeWalker(svg, NodeFilter.SHOW_ELEMENT)
  // TreeWalker starts at root; ensure we also process root.
  let node: Node | null = svg

  while (node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element

      for (const attr of Array.from(el.attributes)) {
        const name = toLowerAscii(attr.name)
        const value = String(attr.value ?? "")

        if (name.startsWith("on")) {
          el.removeAttribute(attr.name)
          continue
        }

        if (name === "href" || name.endsWith(":href")) {
          const v = toLowerAscii(value.trim())
          if (v.startsWith("javascript:")) el.removeAttribute(attr.name)
        }
      }
    }

    node = walker.nextNode()
  }

  return serializeSvgElement(svg)
}

function ensureSvgContract(
  svg: SVGSVGElement,
  opts: Required<SvgTapToFillMountOptions>,
): MountResult {
  if (opts.requireViewBox) {
    const vb = safeTrim(svg.getAttribute("viewBox"))
    if (!vb) return { ok: false, reason: "SVG_VIEWBOX_REQUIRED" }
  }

  const regions = svg.querySelectorAll(opts.regionSelector)
  if (regions.length === 0) return { ok: false, reason: "SVG_NO_REGIONS" }

  if (opts.requireRegionIdPattern) {
    for (const el of Array.from(regions)) {
      const id = safeTrim(el.getAttribute("data-region"))
      if (!id) return { ok: false, reason: "SVG_BAD_REGION_ID:(empty)" }
      if (!opts.regionIdPattern.test(id))
        return { ok: false, reason: `SVG_BAD_REGION_ID:${id}` }
    }
  }

  return { ok: true, svg }
}

/**
 * Parse SVG text into a standalone SVG element (not yet attached to DOM).
 * Uses DOMParser and importNode to ensure correct ownership.
 */
function parseSvgText(svgText: string): SVGSVGElement | null {
  const raw = safeTrim(svgText)
  if (!raw) return null

  const doc = new DOMParser().parseFromString(raw, "image/svg+xml")
  const svg = doc.querySelector("svg") as SVGSVGElement | null
  if (!svg) return null

  return document.importNode(svg, true) as SVGSVGElement
}

/**
 * Mount SVG text into host element with contract enforcement.
 * Deterministic and safe to call multiple times.
 *
 * It replaces all children of `host` with exactly one <svg>.
 */
export function mountSvgIntoHost(
  host: HTMLElement,
  svgText: string,
  options?: SvgTapToFillMountOptions,
): MountResult {
  const opts = mergeOptions(options)

  const normalized = opts.sanitize
    ? sanitizeSvgText(svgText)
    : safeTrim(svgText)
  if (!normalized) {
    host.replaceChildren()
    return { ok: false, reason: "SVG_EMPTY" }
  }

  const parsed = parseSvgText(normalized)
  if (!parsed) {
    host.replaceChildren()
    return { ok: false, reason: "SVG_PARSE_FAILED" }
  }

  const contract = ensureSvgContract(parsed, opts)
  if (!contract.ok) {
    host.replaceChildren()
    return contract
  }

  // Root marker for CSS hit-test policy.
  parsed.setAttribute(opts.rootAttrName, opts.rootAttrValue)

  // Ensure outlines never intercept input (defense-in-depth).
  parsed.querySelectorAll<SVGElement>(opts.outlineSelector).forEach((el) => {
    el.style.pointerEvents = "none"
  })

  // Ensure regions can receive pointer events even if root is pointer-events:none.
  // (CSS is primary; this is fallback.)
  parsed.querySelectorAll<SVGElement>(opts.regionSelector).forEach((el) => {
    if (!el.style.pointerEvents) el.style.pointerEvents = "all"
  })

  host.replaceChildren(parsed)
  return { ok: true, svg: parsed }
}

/**
 * Stable hit-test:
 * - document.elementFromPoint(x,y)
 * - climb parents until element matching regionSelector
 *
 * IMPORTANT:
 * - Works when nested groups are tapped, as long as a parent carries data-region.
 * - x/y are viewport (client) coordinates.
 */
export function hitTestRegionAtPoint(
  xClient: number,
  yClient: number,
  options?: Pick<
    SvgTapToFillMountOptions,
    "regionSelector" | "requireRegionIdPattern" | "regionIdPattern"
  >,
): HitTestResult | null {
  const regionSelector = options?.regionSelector ?? DEFAULT_OPTS.regionSelector
  const requirePattern =
    options?.requireRegionIdPattern ?? DEFAULT_OPTS.requireRegionIdPattern
  const pattern = options?.regionIdPattern ?? DEFAULT_OPTS.regionIdPattern

  const el = document.elementFromPoint(xClient, yClient)
  if (!el || !(el instanceof Element)) return null

  let cur: Element | null = el

  // Hard cap to prevent pathological DOM traversal.
  for (let i = 0; i < 32 && cur; i++) {
    if (cur.matches(regionSelector)) {
      const regionId = safeTrim(cur.getAttribute("data-region"))
      if (!regionId) return null
      if (requirePattern && !pattern.test(regionId)) return null
      return { regionId, element: cur }
    }
    cur = cur.parentElement
  }

  return null
}

/**
 * Apply a fill color to a specific region within the mounted DOM.
 * Returns true if an element was updated.
 */
export function applyFillToRegion(
  host: HTMLElement,
  regionId: string,
  color: string,
): boolean {
  const id = safeTrim(regionId)
  const c = safeTrim(color)
  if (!id || !c) return false

  const sel = `[data-region="${CSS.escape(id)}"]`
  const el = host.querySelector(sel)
  if (!el) return false

  el.setAttribute("fill", c)
  return true
}

/**
 * Optional helper: inject the Stage-2 pointer-events hardening CSS into the page.
 * Call once at app init if you want to keep CSS out of App.tsx.
 */
export function ensureSvgPointerPolicyStyle(
  styleId = "tap2fill-svg-pointer-policy",
  rootAttrName = DEFAULT_OPTS.rootAttrName,
): void {
  if (document.getElementById(styleId)) return

  const style = document.createElement("style")
  style.id = styleId
  style.textContent = `
    [${rootAttrName}] { width: 100%; height: auto; display: block; }
    [${rootAttrName}] { pointer-events: none; user-select: none; }
    [${rootAttrName}] [data-region] { pointer-events: all; cursor: pointer; }
    [${rootAttrName}] [data-role="outline"] { pointer-events: none; }
  `
  document.head.appendChild(style)
}
