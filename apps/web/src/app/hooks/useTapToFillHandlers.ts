// apps/web/src/app/hooks/useTapToFillHandlers.ts
import { useCallback, useEffect, useRef } from "react"
import type React from "react"
import { APP_CONFIG } from "../config/appConfig"
import type { FillMap } from "../coloring"
import { applyFillToRegion, hitTestRegionAtPoint } from "../svgTapToFill"
import { clampInt } from "../domain/guards"

/**
 * Stage-3 progress encoding: JSON FillMap -> standard base64 (NOT base64url).
 *
 * Rationale:
 * - Many decoders (atob/Buffer) assume standard base64 with '+' '/' and '=' padding.
 * - base64url requires decoder cooperation; if mismatched, you typically get empty/failed decode,
 *   which looks like "reset" on undo/restore.
 *
 * Payload is ASCII-safe (region ids + hex colors), so btoa is safe here.
 */
function encodeProgressB64FromFillMap(fills: FillMap): string {
  const json = JSON.stringify(fills ?? {})
  return window.btoa(json)
}

export function useTapToFillHandlers(params: {
  enabled: boolean
  isGesturingRef: React.MutableRefObject<boolean>
  svgHostRef: React.MutableRefObject<HTMLDivElement | null>

  // Current state refs
  fillsRef: React.MutableRefObject<FillMap>
  progressB64Ref: React.MutableRefObject<string>
  paletteIdxRef: React.MutableRefObject<number>

  // Pure getter
  activeColor: () => string

  // Undo history actions (stores previous packed progress)
  pushUndoSnapshot: (prevPackedProgressB64: string) => void

  // Commit after computing next state (business)
  commit: (m: {
    nextFills: FillMap
    nextProgressB64: string
    nextPaletteIdx: number
    tapLabel: string
  }) => Promise<void>
}) {
  const activeTouchIdsRef = useRef<Set<number>>(new Set())

  const {
    enabled,
    isGesturingRef,
    svgHostRef,
    fillsRef,
    progressB64Ref,
    paletteIdxRef,
    activeColor,
    pushUndoSnapshot,
    commit,
  } = params

  const onPointerDownCapture = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled) return
      if (e.pointerType !== "touch") return
      activeTouchIdsRef.current.add(e.pointerId)
    },
    [enabled],
  )

  const onPointerUpCapture = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled) return
      if (e.pointerType !== "touch") return
      // no-op: onPointerUp handles cleanup and validation
    },
    [enabled],
  )

  const onPointerCancelCapture = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled) return
      if (e.pointerType !== "touch") return
      activeTouchIdsRef.current.delete(e.pointerId)
    },
    [enabled],
  )

  useEffect(() => {
    if (!enabled) return
    // If gesture ended, clear stuck touch ids.
    if (!isGesturingRef.current) activeTouchIdsRef.current.clear()
  }, [enabled, isGesturingRef])

  const onPointerUp = useCallback(
    async (e: React.PointerEvent) => {
      if (!enabled) return

      // Prevent iOS synthetic clicks / double-tap zoom behavior.
      e.preventDefault()

      const isTouch = e.pointerType === "touch"
      const touchPid = isTouch ? e.pointerId : null

      try {
        // Ignore if zoom/pan gesture is active.
        if (isGesturingRef.current) return

        // Only primary button for mouse/pen.
        if (!isTouch && typeof e.button === "number" && e.button !== 0) return

        const x = clampInt(e.clientX, 0, window.innerWidth)
        const y = clampInt(e.clientY, 0, window.innerHeight)

        if (isTouch) {
          if (!e.isPrimary) return

          // Multi-touch = zoom/pan; do not treat as tap.
          if (activeTouchIdsRef.current.size >= 2) return

          // Debounce to avoid accidental taps at the end of a gesture.
          await new Promise<void>((resolve) =>
            window.setTimeout(resolve, APP_CONFIG.ui.pointer.touchDebounceMs),
          )

          // If pointer got canceled or another finger joined during debounce.
          if (!activeTouchIdsRef.current.has(e.pointerId)) return
          if (activeTouchIdsRef.current.size >= 2) return
          if (isGesturingRef.current) return
        }

        const host = svgHostRef.current
        if (!host) return

        const hit = hitTestRegionAtPoint(x, y, {
          requireRegionIdPattern: true,
          regionIdPattern: /^R\d{3}$/,
        })

        if (!hit) {
          // No region; do not mutate history.
          await commit({
            nextFills: fillsRef.current,
            nextProgressB64: progressB64Ref.current,
            nextPaletteIdx: paletteIdxRef.current,
            tapLabel: "tap: no region",
          })
          return
        }

        const color = activeColor()
        const prevFills = fillsRef.current
        const prevColor = prevFills[hit.regionId]

        // No-op tap (already same color) -> do nothing (no undo, no commit, no rev bump).
        if (prevColor === color) return

        // Snapshot BEFORE mutation (for undo).
        // IMPORTANT: empty string is a valid "blank page" snapshot.
        pushUndoSnapshot(String(progressB64Ref.current ?? ""))

        // Apply to DOM immediately for perceived responsiveness.
        applyFillToRegion(host, hit.regionId, color)

        const nextFills: FillMap = { ...prevFills, [hit.regionId]: color }

        // Recompute packed progress from nextFills (Stage 3).
        const nextProgressB64 = encodeProgressB64FromFillMap(nextFills)

        await commit({
          nextFills,
          nextProgressB64,
          nextPaletteIdx: paletteIdxRef.current,
          tapLabel: `filled ${hit.regionId} -> ${color}`,
        })
      } finally {
        if (touchPid !== null) activeTouchIdsRef.current.delete(touchPid)
      }
    },
    [
      enabled,
      isGesturingRef,
      svgHostRef,
      fillsRef,
      progressB64Ref,
      paletteIdxRef,
      activeColor,
      pushUndoSnapshot,
      commit,
    ],
  )

  return {
    onPointerDownCapture,
    onPointerUpCapture,
    onPointerCancelCapture,
    onPointerUp,
  }
}
