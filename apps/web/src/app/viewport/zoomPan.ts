/**
 * Stage 3 — Zoom/Pan (P0)
 *
 * Thin, dependency-free zoom/pan controller for a single "content" element inside a container.
 * - Pointer events (mouse/touch/pen) + wheel zoom.
 * - Pinch-to-zoom (2 pointers) + pan.
 * - Reports transform and gesture state:
 *    attach(container, { onTransform, onGestureState }) -> { destroy, getState, setState, reset }
 *
 * IMPORTANT behavioral rule (for Tap-to-Fill):
 * - Do NOT mark isGesturing=true on pointerdown.
 * - Mark isGesturing=true only after:
 *    a) pinch begins (2 pointers), OR
 *    b) drag surpasses a small threshold.
 */

export type Transform = {
  tx: number
  ty: number
  scale: number
}

// Back-compat alias
export type ZoomPanTransform = Transform

export type GestureState = {
  isGesturing: boolean
  isPinching: boolean
  isWheelZooming: boolean
}

export type ZoomPanOptions = {
  minScale?: number
  maxScale?: number
  wheelZoomSpeed?: number
  enableWheelZoom?: boolean
  gestureEndDebounceMs?: number
  usePointerCapture?: boolean
  preventDefault?: boolean
  zoomToPoint?: boolean
  /** Drag threshold before we consider it a gesture (px). Default 4. */
  dragStartThresholdPx?: number
}

export type AttachArgs = {
  onTransform: (t: Transform) => void
  onGestureState?: (s: GestureState) => void
  initial?: Partial<Transform>
  options?: ZoomPanOptions
}

export type ZoomPanController = {
  destroy: () => void
  getState: () => { transform: Transform; gesture: GestureState }
  setState: (t: Partial<Transform>) => void
  reset: () => void
}

const DEFAULTS: Required<ZoomPanOptions> = {
  minScale: 1,
  maxScale: 6,
  wheelZoomSpeed: 0.0015,
  enableWheelZoom: true,
  gestureEndDebounceMs: 80,
  usePointerCapture: true,
  preventDefault: true,
  zoomToPoint: true,
  dragStartThresholdPx: 4,
}

function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n))
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n)
}

type PointerInfo = { id: number; x: number; y: number }

function computeCentroid(
  a: PointerInfo,
  b: PointerInfo,
): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function dist(a: PointerInfo, b: PointerInfo): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

export function attachZoomPan(
  container: HTMLElement,
  args: AttachArgs,
): ZoomPanController {
  const opts: Required<ZoomPanOptions> = {
    ...DEFAULTS,
    ...(args.options ?? {}),
  }

  const t: Transform = {
    tx: isFiniteNumber(args.initial?.tx) ? args.initial!.tx! : 0,
    ty: isFiniteNumber(args.initial?.ty) ? args.initial!.ty! : 0,
    scale: clamp(
      isFiniteNumber(args.initial?.scale) ? args.initial!.scale! : 1,
      opts.minScale,
      opts.maxScale,
    ),
  }

  const g: GestureState = {
    isGesturing: false,
    isPinching: false,
    isWheelZooming: false,
  }

  const pointers = new Map<number, PointerInfo>()

  // Pan (single pointer)
  let panStartX = 0
  let panStartY = 0
  let panStartTx = 0
  let panStartTy = 0

  // Pinch
  let pinchStartDist = 1
  let pinchStartScale = 1
  let pinchStartTx = 0
  let pinchStartTy = 0

  let gestureOffTimer: number | null = null
  let wheelOffTimer: number | null = null

  let rafId: number | null = null
  let pendingEmit = false

  function emitTransform(): void {
    args.onTransform({ ...t })
  }

  function emitGesture(): void {
    args.onGestureState?.({ ...g })
  }

  function scheduleEmit(): void {
    if (pendingEmit) return
    pendingEmit = true
    rafId = window.requestAnimationFrame(() => {
      pendingEmit = false
      emitTransform()
    })
  }

  function setGesturing(on: boolean): void {
    if (g.isGesturing === on) return
    g.isGesturing = on
    emitGesture()
  }

  function setPinching(on: boolean): void {
    if (g.isPinching === on) return
    g.isPinching = on
    emitGesture()
  }

  function setWheelZooming(on: boolean): void {
    if (g.isWheelZooming === on) return
    g.isWheelZooming = on
    emitGesture()
  }

  function clearTimer(ref: number | null): void {
    if (ref !== null) window.clearTimeout(ref)
  }

  function scheduleGestureOff(): void {
    clearTimer(gestureOffTimer)
    gestureOffTimer = window.setTimeout(
      () => {
        gestureOffTimer = null
        if (pointers.size === 0) {
          setPinching(false)
          setGesturing(false)
        }
      },
      Math.max(0, Math.trunc(opts.gestureEndDebounceMs)),
    )
  }

  function scheduleWheelOff(): void {
    clearTimer(wheelOffTimer)
    wheelOffTimer = window.setTimeout(() => {
      wheelOffTimer = null
      setWheelZooming(false)
    }, 120)
  }

  function containerRect(): DOMRect {
    return container.getBoundingClientRect()
  }

  function zoomAboutPoint(
    nextScale: number,
    anchorClientX: number,
    anchorClientY: number,
  ): void {
    const clampedScale = clamp(nextScale, opts.minScale, opts.maxScale)
    if (clampedScale === t.scale) return

    if (!opts.zoomToPoint) {
      t.scale = clampedScale
      scheduleEmit()
      return
    }

    const r = containerRect()
    const ax = anchorClientX - r.left
    const ay = anchorClientY - r.top

    const ratio = clampedScale / t.scale
    t.tx = ax - (ax - t.tx) * ratio
    t.ty = ay - (ay - t.ty) * ratio
    t.scale = clampedScale

    scheduleEmit()
  }

  function resetPointersAndGesture(): void {
    pointers.clear()
    setPinching(false)
    setGesturing(false)
    setWheelZooming(false)
  }

  function onPointerDown(ev: PointerEvent): void {
    if (opts.preventDefault) ev.preventDefault()

    if (opts.usePointerCapture) {
      try {
        container.setPointerCapture(ev.pointerId)
      } catch {
        // ignore
      }
    }

    pointers.set(ev.pointerId, {
      id: ev.pointerId,
      x: ev.clientX,
      y: ev.clientY,
    })

    if (pointers.size === 1) {
      // Arm pan, but do not mark gesturing yet.
      panStartX = ev.clientX
      panStartY = ev.clientY
      panStartTx = t.tx
      panStartTy = t.ty
      setPinching(false)
      // isGesturing stays false until threshold.
      scheduleGestureOff()
      return
    }

    if (pointers.size === 2) {
      // Pinch starts immediately -> gesturing true.
      const [a, b] = Array.from(pointers.values())
      pinchStartDist = Math.max(1, dist(a, b))
      pinchStartScale = t.scale
      pinchStartTx = t.tx
      pinchStartTy = t.ty
      setPinching(true)
      setGesturing(true)

      const c = computeCentroid(a, b)
      zoomAboutPoint(pinchStartScale, c.x, c.y)
      scheduleGestureOff()
      return
    }

    // 3+ pointers: treat as gesturing, but do nothing special.
    setGesturing(true)
    scheduleGestureOff()
  }

  function onPointerMove(ev: PointerEvent): void {
    const p = pointers.get(ev.pointerId)
    if (!p) return
    if (opts.preventDefault) ev.preventDefault()

    p.x = ev.clientX
    p.y = ev.clientY

    if (pointers.size === 1) {
      const dx = ev.clientX - panStartX
      const dy = ev.clientY - panStartY

      if (!g.isGesturing) {
        const d = Math.sqrt(dx * dx + dy * dy)
        if (d < opts.dragStartThresholdPx) {
          scheduleGestureOff()
          return
        }
        // Threshold passed: start panning from this point to avoid jump.
        panStartX = ev.clientX
        panStartY = ev.clientY
        panStartTx = t.tx
        panStartTy = t.ty
        setGesturing(true)
        scheduleGestureOff()
        return
      }

      // Pan
      t.tx = panStartTx + dx
      t.ty = panStartTy + dy
      scheduleEmit()
      scheduleGestureOff()
      return
    }

    if (pointers.size === 2) {
      const [a, b] = Array.from(pointers.values())
      const d = Math.max(1, dist(a, b))
      const nextScale = clamp(
        (d / pinchStartDist) * pinchStartScale,
        opts.minScale,
        opts.maxScale,
      )

      const c = computeCentroid(a, b)

      // base from pinch start translation to minimize drift
      t.tx = pinchStartTx
      t.ty = pinchStartTy
      t.scale = pinchStartScale
      zoomAboutPoint(nextScale, c.x, c.y)

      setPinching(true)
      setGesturing(true)
      scheduleGestureOff()
      return
    }

    setGesturing(true)
    scheduleGestureOff()
  }

  function onPointerUpOrCancel(ev: PointerEvent): void {
    if (opts.preventDefault) ev.preventDefault()

    const pe = ev as PointerEvent
    pointers.delete(pe.pointerId)

    if (opts.usePointerCapture) {
      try {
        container.releasePointerCapture(ev.pointerId)
      } catch {
        // ignore
      }
    }

    if (pointers.size === 0) {
      scheduleGestureOff()
      return
    }

    if (pointers.size === 1) {
      // Continue pan with remaining pointer, but disarm until threshold again.
      const [rem] = Array.from(pointers.values())
      panStartX = rem.x
      panStartY = rem.y
      panStartTx = t.tx
      panStartTy = t.ty
      setPinching(false)
      // Keep isGesturing true only if it already was; else allow taps.
      scheduleGestureOff()
      return
    }

    if (pointers.size === 2) {
      const [a, b] = Array.from(pointers.values())
      pinchStartDist = Math.max(1, dist(a, b))
      pinchStartScale = t.scale
      pinchStartTx = t.tx
      pinchStartTy = t.ty
      setPinching(true)
      setGesturing(true)
      scheduleGestureOff()
      return
    }

    setGesturing(true)
    scheduleGestureOff()
  }

  function onLostPointerCapture(ev: Event): void {
    // iOS/Telegram sometimes drops capture; ensure we don't “stick” in gesturing state.
    const pe = ev as PointerEvent
    pointers.delete(pe.pointerId)
    if (pointers.size === 0) scheduleGestureOff()
  }

  function onWheel(ev: WheelEvent): void {
    if (!opts.enableWheelZoom) return
    if (opts.preventDefault) ev.preventDefault()

    const dy = ev.deltaY
    if (!isFiniteNumber(dy) || dy === 0) return

    const factor = Math.exp(-dy * opts.wheelZoomSpeed)
    const nextScale = t.scale * factor

    setWheelZooming(true)
    scheduleWheelOff()

    zoomAboutPoint(nextScale, ev.clientX, ev.clientY)
  }

  function onWindowBlur(): void {
    resetPointersAndGesture()
  }

  function onVisibilityChange(): void {
    if (document.visibilityState === "hidden") resetPointersAndGesture()
  }

  const peOpts: AddEventListenerOptions = { passive: !opts.preventDefault }
  const wheelOpts: AddEventListenerOptions = { passive: false }

  container.addEventListener("pointerdown", onPointerDown, peOpts)
  container.addEventListener("pointermove", onPointerMove, peOpts)
  container.addEventListener("pointerup", onPointerUpOrCancel, peOpts)
  container.addEventListener("pointercancel", onPointerUpOrCancel, peOpts)
  container.addEventListener("lostpointercapture", onLostPointerCapture, peOpts)
  container.addEventListener("wheel", onWheel, wheelOpts)

  window.addEventListener("blur", onWindowBlur)
  document.addEventListener("visibilitychange", onVisibilityChange)

  emitTransform()
  emitGesture()

  return {
    destroy() {
      container.removeEventListener("pointerdown", onPointerDown)
      container.removeEventListener("pointermove", onPointerMove)
      container.removeEventListener("pointerup", onPointerUpOrCancel)
      container.removeEventListener("pointercancel", onPointerUpOrCancel)
      container.removeEventListener("lostpointercapture", onLostPointerCapture)
      container.removeEventListener("wheel", onWheel)

      window.removeEventListener("blur", onWindowBlur)
      document.removeEventListener("visibilitychange", onVisibilityChange)

      clearTimer(gestureOffTimer)
      clearTimer(wheelOffTimer)

      if (rafId !== null) {
        window.cancelAnimationFrame(rafId)
        rafId = null
      }

      resetPointersAndGesture()
      emitGesture()
    },

    getState() {
      return { transform: { ...t }, gesture: { ...g } }
    },

    setState(next: Partial<Transform>) {
      if (isFiniteNumber(next.tx)) t.tx = next.tx
      if (isFiniteNumber(next.ty)) t.ty = next.ty
      if (isFiniteNumber(next.scale))
        t.scale = clamp(next.scale, opts.minScale, opts.maxScale)
      scheduleEmit()
    },

    reset() {
      t.tx = 0
      t.ty = 0
      t.scale = clamp(1, opts.minScale, opts.maxScale)
      scheduleEmit()
    },
  }
}
