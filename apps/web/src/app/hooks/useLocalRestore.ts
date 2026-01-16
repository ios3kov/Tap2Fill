// apps/web/src/app/hooks/useLocalRestore.ts
import { useEffect } from "react"
import { loadLastPageId, loadPageSnapshot } from "../../local/snapshot"
import { APP_CONFIG } from "../config/appConfig"
import {
  asRecord,
  clampNonNegativeInt,
  normalizePageId,
  safeArrayOfStrings,
} from "../domain/guards"
import type { FillMap } from "../coloring"
import { sanitizeFillMap } from "../domain/fillMap"
import { decodeProgressB64ToFillMap } from "../progress/pack"

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
    ;(async () => {
      const lp = await loadLastPageId()
      const snap = await loadPageSnapshot(
        params.demo.pageId,
        params.demo.contentHash,
      )

      if (cancelled) return

      const normalizedLp = normalizePageId(lp, APP_CONFIG.limits.pageIdMaxLen)
      params.setLastPageId(normalizedLp)
      if (normalizedLp) params.setRoute({ name: "page", pageId: normalizedLp })

      if (!snap) return

      params.setClientRev(clampNonNegativeInt(snap.clientRev, 0))
      params.setDemoCounter(clampNonNegativeInt(snap.demoCounter, 0))

      const nextPaletteIdx =
        typeof snap.paletteIdx === "number" ? snap.paletteIdx : 0
      params.setPaletteIdx(nextPaletteIdx)

      const rec = asRecord(snap)

      const undoStack = safeArrayOfStrings(
        rec?.undoStackB64 ?? rec?.undoStackJson,
        APP_CONFIG.limits.undoStackMax,
      )
      const undoUsed = clampNonNegativeInt(rec?.undoBudgetUsed, 0)
      params.onRestoreUndo(undoStack, undoUsed)

      const packed =
        typeof rec?.progressB64 === "string" ? rec.progressB64.trim() : ""
      const rc = clampNonNegativeInt(rec?.regionsCount, 0)
      const pl = clampNonNegativeInt(rec?.paletteLen, 0)

      if (packed && rc > 0 && pl > 0) {
        params.setProgressB64(packed)

        const decoded = decodeProgressB64ToFillMap({
          progressB64: packed,
          regionsCount: rc,
          paletteLen: pl,
          regionOrder: params.demo.regionOrder,
          palette: params.demo.palette,
        })
        params.setFills(decoded)
        return
      }

      // Legacy fallback
      const legacy = sanitizeFillMap(rec?.fills, {
        maxEntries: APP_CONFIG.limits.fillMapMaxEntries,
      })
      params.setFills(legacy)
      params.setProgressB64("")
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
