// apps/web/src/app/pages/types.ts

/**
 * Stage 3 — Static catalog types (strict, forward-compatible)
 *
 * This module intentionally contains only types + small runtime guards.
 * It enables:
 * - a local pages.json catalog now
 * - a seamless migration to an API later (GET /v1/pages, GET /v1/pages/:id)
 *
 * Design goals:
 * - strong typing for UI
 * - forward/backward compatibility via schemaVersion
 * - minimal, safe runtime validation helpers (no external deps)
 */

export type PageId = string
export type ContentHash = string

/**
 * A palette entry is a CSS color string. In Stage 3 we accept:
 * - #RGB/#RRGGBB/#RRGGBBAA
 * - rgb()/rgba()/hsl()/hsla()
 * - CSS named colors
 *
 * Validation is intentionally permissive to avoid false negatives.
 */
export type CssColor = string

/**
 * Describes how the client resolves the SVG source.
 * - In Stage 3: local raw import key (e.g., "demoPage.svg")
 * - Later: can become a URL to R2/CDN (immutable by contentHash).
 */
export type SvgSource =
  | {
      kind: "rawImport"
      /** Vite raw import key relative to this feature (e.g., "demoPage.svg") */
      rawImportKey: string
    }
  | {
      kind: "url"
      /** Absolute or origin-relative URL */
      url: string
    }

/**
 * Thumbnail source (origin-relative path or absolute URL).
 */
export type ThumbSource =
  | { kind: "path"; path: string }
  | { kind: "url"; url: string }

/**
 * Page metadata consumed by the Gallery and Page loader.
 * Keep this stable and additive to avoid breaking persisted state.
 */
export type PageMeta = {
  id: PageId
  title: string

  /**
   * Stable slug used for local asset naming and future routes.
   * Example: "demoPage" or "animals/fox_01".
   */
  slug: string

  /**
   * For static catalog: where the SVG is sourced from.
   * Keep "rawImportKey" for Stage 3. Later you can switch to url().
   */
  svg: SvgSource

  /**
   * Immutable content hash. Must change whenever the SVG regions change.
   * Used to namespace snapshots and prevent collisions across versions.
   */
  contentHash: ContentHash

  /**
   * Total number of interactive regions in the SVG.
   * Required for packed progress validation in later stages.
   */
  regionsCount: number

  /**
   * Page-specific palette. If omitted, UI can fall back to DEFAULT_PALETTE.
   */
  palette?: CssColor[]

  /**
   * Optional thumb used by Gallery.
   */
  thumb?: ThumbSource

  /**
   * Optional flags for future features (locked/premium, difficulty tags, etc.)
   */
  tags?: string[]
}

/**
 * Static catalog file format (pages.json) loaded by the web client.
 */
export type CatalogFileV1 = {
  schemaVersion: 1
  generatedAt?: string // ISO timestamp
  defaultPageId?: PageId
  defaultPageLimit?: number
  pages: Array<{
    id: PageId
    title: string
    slug: string

    // Back-compat fields for Stage 3 pages.json
    svgRawImportKey?: string // deprecated: use svg
    thumbUrl?: string // deprecated: use thumb

    // Preferred structured fields
    svg?: SvgSource
    thumb?: ThumbSource

    regionsCount: number
    contentHash: ContentHash
    palette?: CssColor[]
    tags?: string[]
  }>
}

/**
 * What the UI consumes after normalization.
 */
export type Catalog = {
  schemaVersion: 1
  generatedAt?: string
  defaultPageId?: PageId
  defaultPageLimit: number
  pages: PageMeta[]
}

/**
 * API-aligned response shape (for Stage 6+), used by UI even when local.
 * Cursor pagination is modeled explicitly to avoid ad-hoc "page=2" assumptions.
 */
export type CatalogResponse = {
  schemaVersion: 1
  items: PageMeta[]
  nextCursor: string | null
}

/**
 * Minimal runtime helpers (safe, dependency-free).
 * Use these at the boundary where JSON is parsed.
 */

export function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null
}

export function asString(x: unknown): string | null {
  return typeof x === "string" ? x : null
}

export function asNumber(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null
}

export function asStringArray(x: unknown): string[] | null {
  if (!Array.isArray(x)) return null
  for (const v of x) if (typeof v !== "string") return null
  return x
}

export function clampRegionsCount(n: number): number {
  // Defensive bounds to prevent pathological memory use downstream.
  // Adjust as product constraints evolve.
  const min = 1
  const max = 50_000
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

/**
 * Normalize a possibly legacy pages.json entry into PageMeta.
 * Supports:
 * - svgRawImportKey / thumbUrl legacy fields
 * - structured svg/thumb fields (preferred)
 */
export function normalizePageMeta(
  entry: CatalogFileV1["pages"][number],
): PageMeta | null {
  if (!isRecord(entry)) return null

  const id = asString(entry.id)
  const title = asString(entry.title)
  const slug = asString(entry.slug)
  const contentHash = asString(entry.contentHash)
  const regionsCountRaw = asNumber(entry.regionsCount)

  if (!id || !title || !slug || !contentHash || regionsCountRaw === null)
    return null

  const regionsCount = clampRegionsCount(regionsCountRaw)

  // Resolve svg source
  let svg: SvgSource | null = null

  if (isRecord(entry.svg) && asString(entry.svg.kind) === "rawImport") {
    const rawImportKey = asString(
      (entry.svg as Record<string, unknown>).rawImportKey,
    )
    if (rawImportKey) svg = { kind: "rawImport", rawImportKey }
  } else if (isRecord(entry.svg) && asString(entry.svg.kind) === "url") {
    const url = asString((entry.svg as Record<string, unknown>).url)
    if (url) svg = { kind: "url", url }
  } else {
    // Legacy fallback
    const legacyKey = asString(entry.svgRawImportKey)
    if (legacyKey) svg = { kind: "rawImport", rawImportKey: legacyKey }
  }

  if (!svg) return null

  // Resolve thumb source (optional)
  let thumb: ThumbSource | undefined
  if (isRecord(entry.thumb) && asString(entry.thumb.kind) === "path") {
    const path = asString((entry.thumb as Record<string, unknown>).path)
    if (path) thumb = { kind: "path", path }
  } else if (isRecord(entry.thumb) && asString(entry.thumb.kind) === "url") {
    const url = asString((entry.thumb as Record<string, unknown>).url)
    if (url) thumb = { kind: "url", url }
  } else {
    const legacyThumb = asString(entry.thumbUrl)
    if (legacyThumb) thumb = { kind: "path", path: legacyThumb }
  }

  // Palette (optional)
  const palette = Array.isArray(entry.palette)
    ? entry.palette.filter((c) => typeof c === "string")
    : undefined

  // Tags (optional)
  const tags = asStringArray(entry.tags) ?? undefined

  return {
    id,
    title,
    slug,
    svg,
    contentHash,
    regionsCount,
    palette,
    thumb,
    tags,
  }
}
