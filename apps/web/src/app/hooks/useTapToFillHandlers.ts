// apps/web/src/app/hooks/useTapToFillHandlers.ts
import { useCallback, useEffect, useMemo, useRef } from "react"
import type React from "react"
import { APP_CONFIG } from "../config/appConfig"
import type { FillMap } from "../coloring"
import { clampInt } from "../domain/guards"
import {
  compilePackContext,
  encodeBytesToBase64,
  makeEmptyProgressBytes,
  packFillMapToBytesWithContext,
  type PackContext,
} from "../progress/pack"
import { applyFillToRegion, hitTestRegionAtPoint } from "../svgTapToFill"

/**
 * Tap-to-fill handlers (Stage 3)
 *
 * Invariants (Undo/Restore correctness):
 * - progressB64 is always canonical "bytes-packed" base64.
 * - empty page is represented as bytes-packed base64 (NOT "").
 * - undo snapshots store the previous packed progressB64 (including empty snapshot).
 *
 * Safety / resilience:
 * - ignores unknown regions/colors during packing (content updates won't crash clients).
 * - guards multi-touch and gesture mode to prevent accidental fills during zoom/pan.
 *
 * Performance:
 * - compiles PackContext once (region/palette normalization + index maps) and reuses it on every tap.
 *
 * Concurrency:
 * - prevents overlapping commits (race conditions) by locking during commit().
 */
export function useTapToFillHandlers(params: {
  enabled: boolean
  isGesturingRef: React.MutableRefObject<boolean>
  svgHostRef: React.MutableRefObject<HTMLDivElement | null>

  // Current state refs
  fillsRef: React.MutableRefObject<FillMap>
  progressB64Ref: React.MutableRefObject<string>
  paletteIdxRef: React.MutableRefObject<number>

  // Canonical packing inputs (Stage 3)
  regionOrder: readonly string[]
  palette: readonly string[]

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

  // Prevent overlapping commit() calls (race conditions on slow persistence).
  const isCommittingRef = useRef(false)

  const {
    enabled,
    isGesturingRef,
    svgHostRef,
    fillsRef,
    progressB64Ref,
    paletteIdxRef,
    regionOrder,
    palette,
    activeColor,
    pushUndoSnapshot,
    commit,
  } = params

  /**
   * Compile packing context once.
   * In strict mode this will fail fast for broken inputs (duplicate/empty ids, etc).
   */
  const packCtx: PackContext = useMemo(() => {
    return compilePackContext(regionOrder, palette, {
      strictInputs: true,
      allowDuplicateRegionIds: false,
      allowDuplicatePaletteColors: false,
      ignoreUnknownRegions: true,
      ignoreUnknownColors: true,
    })
  }, [regionOrder, palette])

  /**
   * Canonical empty snapshot for this page's regionsCount.
   * This prevents "undo looks like reset" due to empty/invalid base64.
   */
  const emptyProgressB64 = useMemo(() => {
    const bytes = makeEmptyProgressBytes(packCtx.regionsCount, packCtx.opts)
    return encodeBytesToBase64(bytes)
  }, [packCtx.regionsCount, packCtx.opts])

  /**
   * Stable getter: always returns a valid packed progress (never empty string).
   * Used for undo snapshots.
   */
  const getPrevPackedProgress = useCallback((): string => {
    const s = String(progressB64Ref.current ?? "").trim()
    return s.length > 0 ? s : emptyProgressB64
  }, [progressB64Ref, emptyProgressB64])

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
      // no-op; cleanup happens in onPointerUp
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

        // If a commit is already in flight, drop this tap.
        if (isCommittingRef.current) return

        const x = clampInt(e.clientX, 0, window.innerWidth)
        const y = clampInt(e.clientY, 0, window.innerHeight)

        if (isTouch) {
          if (!e.isPrimary) return

          // Multi-touch = zoom/pan; do not treat as tap.
          if (activeTouchIdsRef.current.size >= 2) return

          await new Promise<void>((resolve) =>
            window.setTimeout(resolve, APP_CONFIG.ui.pointer.touchDebounceMs),
          )

          // If pointer got canceled or another finger joined during debounce.
          if (!activeTouchIdsRef.current.has(e.pointerId)) return
          if (activeTouchIdsRef.current.size >= 2) return
          if (isGesturingRef.current) return

          // Re-check commit lock after debounce.
          if (isCommittingRef.current) return
        }

        const host = svgHostRef.current
        if (!host) return

        const hit = hitTestRegionAtPoint(x, y, {
          requireRegionIdPattern: true,
          regionIdPattern: /^R\d{3}$/,
        })

        if (!hit) return

        const color = activeColor()
        const prevFills = fillsRef.current
        const prevColor = prevFills[hit.regionId]

        // No-op tap: do nothing (no undo, no commit).
        if (prevColor === color) return

        // From this point, we're going to commit. Lock.
        isCommittingRef.current = true

        // Snapshot BEFORE mutation (undo must restore previous packed progress).
        pushUndoSnapshot(getPrevPackedProgress())

        // Apply to DOM immediately for perceived responsiveness.
        applyFillToRegion(host, hit.regionId, color)

        const nextFills: FillMap = { ...prevFills, [hit.regionId]: color }

        // Canonical Stage-3 packing (fast path): FillMap -> bytes -> base64
        const nextBytes = packFillMapToBytesWithContext(nextFills, packCtx)
        const nextProgressB64 = encodeBytesToBase64(nextBytes)

        await commit({
          nextFills,
          nextProgressB64,
          nextPaletteIdx: paletteIdxRef.current,
          tapLabel: `filled ${hit.regionId} -> ${color}`,
        })
      } finally {
        if (touchPid !== null) activeTouchIdsRef.current.delete(touchPid)
        isCommittingRef.current = false
      }
    },
    [
      enabled,
      isGesturingRef,
      svgHostRef,
      fillsRef,
      paletteIdxRef,
      activeColor,
      pushUndoSnapshot,
      commit,
      getPrevPackedProgress,
      packCtx,
    ],
  )

  return {
    onPointerDownCapture,
    onPointerUpCapture,
    onPointerCancelCapture,
    onPointerUp,
  }
}