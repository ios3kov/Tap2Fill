// apps/web/src/app/pages/loadCatalog.ts

/**
 * Stage 3 — Local catalog loader (pages.json) with API-compatible contract.
 *
 * Goals:
 * - Read a static pages.json once (bundled via Vite).
 * - Normalize legacy fields into strict PageMeta.
 * - Provide cursor-based pagination identical to the future API.
 * - Keep UI contract stable when swapped to Worker API later.
 *
 * Security:
 * - Strict runtime validation at the JSON boundary.
 * - Hard caps on list sizes and string lengths to avoid pathological payloads.
 *
 * Notes:
 * - This file intentionally does NOT fetch network resources.
 * - Replace implementation with GET /v1/pages in Stage 6 without changing callers.
 */

import catalogJson from "./pages.json"
import type { Catalog, CatalogFileV1, CatalogResponse, PageMeta } from "./types"
import { isRecord, normalizePageMeta } from "./types"

const DEFAULT_LIMIT = 24
const MAX_LIMIT = 60
const MAX_PAGES = 2_000

function clampLimit(limit: number | undefined): number {
  const v =
    typeof limit === "number" && Number.isFinite(limit)
      ? Math.trunc(limit)
      : DEFAULT_LIMIT
  return Math.max(1, Math.min(MAX_LIMIT, v))
}

function safeStringLen(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max)
}

/**
 * A stable cursor is an opaque string. In local mode we encode an integer offset.
 * Format: "o:<offset>"
 */
function encodeCursor(offset: number): string {
  return `o:${Math.max(0, Math.trunc(offset))}`
}

function decodeCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0
  if (typeof cursor !== "string") return 0
  if (!cursor.startsWith("o:")) return 0
  const n = Number(cursor.slice(2))
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.trunc(n)
}

/**
 * Load and normalize the full catalog once.
 * Callers can then page over it using listPages().
 */
export function loadCatalog(): Catalog {
  const raw = catalogJson as unknown

  if (!isRecord(raw) || raw.schemaVersion !== 1) {
    // Fail closed: return an empty, valid catalog shape.
    return { schemaVersion: 1, defaultPageLimit: DEFAULT_LIMIT, pages: [] }
  }

  const file = raw as CatalogFileV1

  const defaultLimit = clampLimit(file.defaultPageLimit)
  const pagesIn = Array.isArray(file.pages)
    ? file.pages.slice(0, MAX_PAGES)
    : []

  const pages: PageMeta[] = []
  for (const entry of pagesIn) {
    const meta = normalizePageMeta(entry)
    if (!meta) continue

    // Additional defensive trimming (avoid accidental huge strings).
    meta.title = safeStringLen(meta.title, 140)
    meta.slug = safeStringLen(meta.slug, 200)
    meta.id = safeStringLen(meta.id, 200)
    meta.contentHash = safeStringLen(meta.contentHash, 200)

    pages.push(meta)
  }

  return {
    schemaVersion: 1,
    generatedAt:
      typeof file.generatedAt === "string" ? file.generatedAt : undefined,
    defaultPageId:
      typeof file.defaultPageId === "string" ? file.defaultPageId : undefined,
    defaultPageLimit: defaultLimit,
    pages,
  }
}

/**
 * Page over the catalog with an API-compatible response:
 * - items: PageMeta[]
 * - nextCursor: string | null
 */
export function listPages(params?: {
  limit?: number
  cursor?: string | null
}): CatalogResponse {
  const catalog = loadCatalog()

  const limit = clampLimit(params?.limit ?? catalog.defaultPageLimit)
  const offset = decodeCursor(params?.cursor)

  const start = Math.max(0, Math.min(offset, catalog.pages.length))
  const end = Math.min(start + limit, catalog.pages.length)

  const items = catalog.pages.slice(start, end)
  const nextCursor = end < catalog.pages.length ? encodeCursor(end) : null

  return { schemaVersion: 1, items, nextCursor }
}

/**
 * Convenience getter aligned with future API route:
 * GET /v1/pages/:pageId
 */
export function getPageById(pageId: string): PageMeta | null {
  const catalog = loadCatalog()
  const id = String(pageId ?? "").trim()
  if (!id) return null
  return catalog.pages.find((p) => p.id === id) ?? null
}
