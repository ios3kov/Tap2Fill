// apps/web/src/app/hooks/useZoomPan.ts
import { useEffect, useRef } from "react"
import {
  attachZoomPan,
  type Transform as ZoomPanTransform,
} from "../viewport/zoomPan"

/**
 * Imperative transform application (hot path).
 * translate3d nudges GPU compositing on most browsers.
 */
export function applyTransformStyle(el: HTMLElement, t: ZoomPanTransform): void {
  el.style.transform = `translate3d(${t.tx}px, ${t.ty}px, 0) scale(${t.scale})`
}

/**
 * Zoom/Pan bridge between an imperative viewport engine and React state.
 *
 * Design goals:
 * - Visual updates are applied immediately (hot path) via direct DOM writes.
 * - React state updates are throttled (cold path) to reduce render pressure.
 * - Gesture state is propagated promptly to prevent accidental taps during zoom/pan.
 *
 * Notes:
 * - attachZoomPan is the source of truth for gesture physics/pivot/inertia.
 *   This hook focuses on safe orchestration and performance boundaries.
 */
export function useZoomPan(params: {
  enabled: boolean
  containerRef: React.MutableRefObject<HTMLDivElement | null>
  contentRef: React.MutableRefObject<HTMLDivElement | null>

  transform: ZoomPanTransform
  setTransform: (t: ZoomPanTransform) => void
  setIsGesturing: (v: boolean) => void

  /**
   * Optional tuning:
   * - maxStateFps: limit React state updates (default 30 FPS).
   *   Hot-path DOM updates are NOT throttled.
   */
  maxStateFps?: number
}) {
  const {
    enabled,
    containerRef,
    contentRef,
    transform,
    setTransform,
    setIsGesturing,
    maxStateFps,
  } = params

  const lastStateUpdateMsRef = useRef(0)
  const lastTransformRef = useRef<ZoomPanTransform>(transform)
  const rafPendingRef = useRef(false)
  const lastGestureRef = useRef(false)

  useEffect(() => {
    lastTransformRef.current = transform
  }, [transform])

  useEffect(() => {
    if (!enabled) return

    const container = containerRef.current
    const content = contentRef.current
    if (!container || !content) return

    // Apply initial transform once (ensures DOM matches state on mount).
    applyTransformStyle(content, transform)

    const fps = Math.max(1, Math.min(120, Math.trunc(maxStateFps ?? 30)))
    const minIntervalMs = 1000 / fps

    const scheduleStateUpdate = (t: ZoomPanTransform) => {
      lastTransformRef.current = t

      // Ensure at least one state update is delivered even under heavy gesture input.
      if (rafPendingRef.current) return
      rafPendingRef.current = true

      requestAnimationFrame(() => {
        rafPendingRef.current = false

        const now = performance.now()
        if (now - lastStateUpdateMsRef.current < minIntervalMs) return

        lastStateUpdateMsRef.current = now
        setTransform(lastTransformRef.current)
      })
    }

    const zp = attachZoomPan(container, {
      initial: transform,
      onTransform: (t) => {
        const el = contentRef.current
        if (!el) return

        // Hot path: immediate visual update.
        applyTransformStyle(el, t)

        // Cold path: throttled React state update.
        scheduleStateUpdate(t)
      },
      onGestureState: (s) => {
        const next = Boolean(s.isGesturing || s.isWheelZooming)

        // Avoid spamming setState with the same value.
        if (next !== lastGestureRef.current) {
          lastGestureRef.current = next
          setIsGesturing(next)
        }
      },
    })

    return () => {
      try {
        zp.destroy()
      } finally {
        rafPendingRef.current = false
      }
    }
    // Intentionally NOT depending on `transform` to avoid re-attaching the engine
    // during interaction. Initial transform is applied once on enable/mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, containerRef, contentRef, setTransform, setIsGesturing, maxStateFps])
}