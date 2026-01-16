// apps/web/src/app/hooks/useLocalRestore.ts
import { useEffect } from "react"
import { loadLastPageId, loadPageSnapshot } from "../../local/snapshot"
import { APP_CONFIG } from "../config/appConfig"
import { clampNonNegativeInt, normalizePageId } from "../domain/guards"
import type { FillMap } from "../coloring"
import { decodeProgressB64ToFillMap } from "../progress/pack"

/**
 * Local restore (Stage 3+)
 *
 * Contract:
 * - Storage layer (local/snapshot.ts) returns a normalized PageSnapshotV2 or null.
 * - This hook applies it to UI state and restores undo history.
 *
 * Performance:
 * - Loads lastPageId and snapshot in parallel (Promise.all).
 *
 * Safety:
 * - cancellable async effect to avoid state updates after unmount.
 * - defensive clamping for numeric fields.
 */
export function useLocalRestore(params: {
  demo: {
    pageId: string
    contentHash: string
    regionsCount: number
    palette: readonly string[]
    regionOrder: readonly string[]
  }
  setRoute: (r: { name: "gallery" } | { name: "page"; pageId: string }) => void
  setLastPageId: (v: string | null) => void

  setClientRev: (v: number) => void
  setDemoCounter: (v: number) => void
  setPaletteIdx: (v: number) => void
  setProgressB64: (v: string) => void
  setFills: (v: FillMap) => void

  onRestoreUndo: (stack: string[], used: number) => void
}) {
  useEffect(() => {
    let cancelled = false

    const run = async (): Promise<void> => {
      const [rawLastPageId, snapshot] = await Promise.all([
        loadLastPageId(),
        loadPageSnapshot(params.demo.pageId, params.demo.contentHash, {
          regionsCount: params.demo.regionsCount,
          paletteLen: params.demo.palette.length,
        }),
      ])
      if (cancelled) return

      const normalizedLastPageId = normalizePageId(
        rawLastPageId,
        APP_CONFIG.limits.pageIdMaxLen,
      )

      params.setLastPageId(normalizedLastPageId)
      if (normalizedLastPageId) {
        params.setRoute({ name: "page", pageId: normalizedLastPageId })
      }

      if (!snapshot) return

      // Numbers are already normalized by storage, but clamp for defense-in-depth.
      params.setClientRev(clampNonNegativeInt(snapshot.clientRev, 0))
      params.setDemoCounter(clampNonNegativeInt(snapshot.demoCounter, 0))
      params.setPaletteIdx(clampNonNegativeInt(snapshot.paletteIdx, 0))

      // Storage guarantees normalized v2 types.
      params.onRestoreUndo(
        snapshot.undoStackB64.slice(0, APP_CONFIG.limits.undoStackMax),
        clampNonNegativeInt(snapshot.undoBudgetUsed, 0),
      )

      const packed =
        typeof snapshot.progressB64 === "string" ? snapshot.progressB64.trim() : ""
      const rc = clampNonNegativeInt(snapshot.regionsCount, 0)
      const pl = clampNonNegativeInt(snapshot.paletteLen, 0)

      if (packed && rc > 0 && pl > 0) {
        // Decode first, then apply fills+progress as a single coherent update.
        const fills = decodeProgressB64ToFillMap({
          progressB64: packed,
          regionsCount: rc,
          paletteLen: pl,
          regionOrder: params.demo.regionOrder,
          palette: params.demo.palette,
        })

        params.setFills(fills)
        params.setProgressB64(packed)
        return
      }

      // Should not happen for normalized v2; fall back safely.
      params.setFills({})
      params.setProgressB64("")
    }

    void run()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}