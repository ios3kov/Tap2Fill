// apps/web/src/app/ui/Gallery.tsx

import { useEffect, useMemo, useState } from "react"
import type { CatalogResponse, PageMeta } from "../pages/types"
import { listPages } from "../pages/loadCatalog"

export type GalleryItemProgress = {
  pageId: string
  /** 0..1 */
  ratio: number
  completed: boolean
}

export type GalleryProgressMap = Record<string, GalleryItemProgress>

export type GalleryProps = {
  /**
   * Optional: progress for pages (local-only for now).
   * If omitted, gallery still works and shows "0%".
   */
  progressByPageId?: GalleryProgressMap

  /**
   * The page that Continue should open (if available).
   */
  lastPageId?: string | null

  /**
   * Called when user chooses a page to open.
   * Parent decides routing (single-page Stage 3 can just set currentPageId).
   */
  onOpenPage: (page: PageMeta, intent: "continue" | "open") => void

  /**
   * Optional: override page size for UI pagination.
   */
  pageSize?: number

  className?: string
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

function pct(ratio: number): string {
  const v = Math.round(clamp01(ratio) * 100)
  return `${v}%`
}

function safeText(s: unknown, fallback = ""): string {
  if (typeof s !== "string") return fallback
  const t = s.trim()
  return t ? t : fallback
}

function hasOwn(o: object, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k)
}

/**
 * Stage 3 Gallery:
 * - Reads static catalog in batches (cursor pagination).
 * - Renders cards: thumb/title/progress/completed.
 * - Provides Continue/Open entry points.
 *
 * Security / robustness:
 * - Does not render arbitrary HTML.
 * - Uses <img> with safe attributes; URLs are treated as app-controlled assets.
 * - Avoids exceptions on malformed progress maps.
 */
export default function Gallery(props: GalleryProps) {
  const {
    progressByPageId,
    lastPageId,
    onOpenPage,
    pageSize = 12,
    className,
  } = props

  const limit = useMemo(() => {
    const n = Math.trunc(pageSize)
    return Number.isFinite(n) ? Math.max(1, Math.min(60, n)) : 12
  }, [pageSize])

  const [items, setItems] = useState<PageMeta[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const continueTarget = useMemo(() => {
    const id = safeText(lastPageId, "")
    if (!id) return null
    return items.find((p) => p.id === id) ?? null
  }, [items, lastPageId])

  function readProgress(pageId: string): GalleryItemProgress | null {
    const map = progressByPageId
    if (!map || typeof map !== "object") return null
    if (!hasOwn(map, pageId)) return null
    const p = (map as GalleryProgressMap)[pageId]
    if (!p || typeof p !== "object") return null
    const ratio = clamp01((p as GalleryItemProgress).ratio)
    const completed = Boolean((p as GalleryItemProgress).completed)
    return { pageId, ratio, completed }
  }

  function loadFirstPage() {
    setLoading(true)
    setErr(null)
    try {
      const res: CatalogResponse = listPages({ limit, cursor: null })
      setItems(res.items)
      setNextCursor(res.nextCursor)
    } catch (e) {
      setErr((e as Error)?.message || "Failed to load catalog")
      setItems([])
      setNextCursor(null)
    } finally {
      setLoading(false)
    }
  }

  function loadMore() {
    if (!nextCursor || loading) return
    setLoading(true)
    setErr(null)
    try {
      const res: CatalogResponse = listPages({ limit, cursor: nextCursor })
      setItems((prev) => {
        // Deterministic concat; avoid duplicates by id just in case.
        const seen = new Set(prev.map((p) => p.id))
        const merged = [...prev]
        for (const it of res.items) {
          if (!seen.has(it.id)) merged.push(it)
        }
        return merged
      })
      setNextCursor(res.nextCursor)
    } catch (e) {
      setErr((e as Error)?.message || "Failed to load more")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadFirstPage()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit])

  return (
    <section className={className} aria-label="Gallery">
      <div className="t2f-galleryHeader">
        <div>
          <h2 className="t2f-h2">Gallery</h2>
          <div className="t2f-muted">Choose a page to color.</div>
        </div>

        <div className="t2f-galleryActions">
          <button
            className="t2f-btn"
            disabled={!continueTarget}
            onClick={() => {
              if (continueTarget) onOpenPage(continueTarget, "continue")
            }}
            title={continueTarget ? "Continue last page" : "No last page yet"}
            style={{ opacity: continueTarget ? 1 : 0.5 }}
          >
            Continue
          </button>
        </div>
      </div>

      {err ? (
        <div className="t2f-alert" role="alert">
          <div className="t2f-alertTitle">Catalog error</div>
          <div className="t2f-alertBody">{err}</div>
          <button
            className="t2f-btn"
            onClick={loadFirstPage}
            style={{ marginTop: 10 }}
          >
            Retry
          </button>
        </div>
      ) : null}

      <div
        className="t2f-grid"
        role="list"
        aria-busy={loading ? "true" : "false"}
      >
        {items.map((p) => {
          const title = safeText(p.title, p.id)
          const thumbUrl = safeText(p.thumbUrl, "")
          const prog = readProgress(p.id)
          const ratio = prog ? prog.ratio : 0
          const completed = prog ? prog.completed : false

          return (
            <article
              className="t2f-card t2f-cardCompact"
              role="listitem"
              key={p.id}
            >
              <div className="t2f-thumb">
                {thumbUrl ? (
                  <img
                    src={thumbUrl}
                    alt={title}
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    className="t2f-thumbImg"
                  />
                ) : (
                  <div className="t2f-thumbPlaceholder" aria-hidden="true" />
                )}

                <div className="t2f-badgeRow">
                  {completed ? (
                    <span className="t2f-badge t2f-badgeDone">Completed</span>
                  ) : null}
                  <span className="t2f-badge">{pct(ratio)}</span>
                </div>
              </div>

              <div className="t2f-cardBody">
                <div className="t2f-title" title={title}>
                  {title}
                </div>

                <div className="t2f-progress">
                  <div className="t2f-progressBar" aria-hidden="true">
                    <div
                      className="t2f-progressFill"
                      style={{ width: pct(ratio) }}
                    />
                  </div>
                  <div className="t2f-progressMeta">
                    <span className="t2f-muted">Progress</span>
                    <strong>{pct(ratio)}</strong>
                  </div>
                </div>

                <div className="t2f-cardActions">
                  <button
                    className="t2f-btn"
                    onClick={() => onOpenPage(p, "open")}
                  >
                    Open
                  </button>
                </div>
              </div>
            </article>
          )
        })}
      </div>

      <div className="t2f-galleryFooter">
        <button
          className="t2f-btn"
          onClick={loadMore}
          disabled={!nextCursor || loading}
          style={{ opacity: !nextCursor || loading ? 0.6 : 1 }}
        >
          {nextCursor ? (loading ? "Loading…" : "Load more") : "No more pages"}
        </button>
      </div>
    </section>
  )
}
