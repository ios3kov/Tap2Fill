// apps/web/src/app/viewport/zoomPan.ts
/**
 * Stage 3 — Zoom/Pan (P0)
 *
 * Thin, dependency-free zoom/pan controller for a single "content" element inside a container.
 * - Pointer events (mouse/touch/pen) + wheel zoom.
 * - Pinch-to-zoom (2 pointers) + pan.
 * - Optional pan momentum (inertia) after release.
 * - Reports transform and gesture state:
 *    attachZoomPan(container, { onTransform, onGestureState }) -> { destroy, getState, setState, reset }
 *
 * Notes:
 * - This controller applies transforms via callback only. You decide how to render (CSS transform, canvas, etc).
 * - Intended usage: container contains a content element (e.g., SVG host) you transform.
 * - For best UX, set CSS `touch-action: none;` on the container.
 */

export type Transform = {
  /** Translation in CSS pixels (screen space). */
  tx: number
  ty: number
  /** Uniform scale. */
  scale: number
}

// Back-compat aliases used by App.tsx in some integrations
export type ZoomPanTransform = Transform

export type GestureState = {
  /** True while user is actively panning or pinching (pointer-based). */
  isGesturing: boolean
  /** True while pinch (2 pointers) is active. */
  isPinching: boolean
  /** True while a wheel-zoom interaction is happening (short-lived). */
  isWheelZooming: boolean
}

export type ZoomPanOptions = {
  /** Minimum allowed scale. Default 1. */
  minScale?: number
  /** Maximum allowed scale. Default 6. */
  maxScale?: number

  /**
   * Wheel zoom speed. Positive values. Default 0.0015.
   * Effective factor: scale *= exp(-deltaY * wheelZoomSpeed)
   */
  wheelZoomSpeed?: number

  /** Whether to enable wheel zoom. Default true. */
  enableWheelZoom?: boolean

  /**
   * Gesture end debounce (ms). Used to keep isGesturing true briefly after last movement,
   * helping UI avoid flicker. Default 80ms.
   */
  gestureEndDebounceMs?: number

  /**
   * If true (default), we call setPointerCapture on pointerdown and release on end.
   * Improves tracking outside bounds.
   */
  usePointerCapture?: boolean

  /**
   * If true (default), prevents default browser behavior for touch/pointers where safe.
   * You should also set CSS `touch-action: none;` on the container.
   */
  preventDefault?: boolean

  /**
   * When true (default), zoom is centered around pointer position / pinch centroid.
   */
  zoomToPoint?: boolean

  /**
   * Enable pan inertia (momentum) after releasing a single-pointer drag.
   * Default false (keeps controller minimal and predictable).
   */
  enableMomentum?: boolean

  /**
   * Momentum friction in 1/sec (exponential decay factor).
   * Larger => stops faster. Default 12.
   */
  momentumFriction?: number

  /**
   * Minimum velocity in px/sec to start momentum. Default 120.
   */
  momentumMinVelocity?: number

  /**
   * Hard cap for momentum speed in px/sec (defense-in-depth). Default 4000.
   */
  momentumMaxVelocity?: number
}

export type AttachArgs = {
  onTransform: (t: Transform) => void
  onGestureState?: (s: GestureState) => void
  initial?: Partial<Transform>
  options?: ZoomPanOptions
}

export type ZoomPanController = {
  destroy: () => void
  /** Current internal state. */
  getState: () => { transform: Transform; gesture: GestureState }
  /** Programmatically set transform (clamped). */
  setState: (t: Partial<Transform>) => void
  /** Reset to identity (scale=1, tx=0, ty=0). */
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

  enableMomentum: false,
  momentumFriction: 12,
  momentumMinVelocity: 120,
  momentumMaxVelocity: 4000,
}

function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n))
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n)
}

type PointerInfo = {
  id: number
  x: number
  y: number
}

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

/**
 * Attach zoom/pan controller to a container element.
 */
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

  // Gesture end debounce
  let gestureOffTimer: number | null = null

  // Wheel debounce
  let wheelOffTimer: number | null = null

  // Throttle transform emissions (rAF)
  let rafId: number | null = null
  let pendingEmit = false

  // Momentum (single-pointer)
  let momentumRafId: number | null = null
  let velX = 0 // px/sec
  let velY = 0 // px/sec
  let lastMoveTs = 0 // ms
  let lastMoveX = 0
  let lastMoveY = 0

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

  function stopMomentum(): void {
    if (momentumRafId !== null) {
      window.cancelAnimationFrame(momentumRafId)
      momentumRafId = null
    }
    velX = 0
    velY = 0
    lastMoveTs = 0
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

  function recordPanVelocity(clientX: number, clientY: number): void {
    // Only meaningful for single-pointer pan when momentum is enabled.
    if (!opts.enableMomentum) return

    const now = performance.now()
    if (lastMoveTs <= 0) {
      lastMoveTs = now
      lastMoveX = clientX
      lastMoveY = clientY
      velX = 0
      velY = 0
      return
    }

    const dtMs = now - lastMoveTs
    if (dtMs <= 0) return

    const dx = clientX - lastMoveX
    const dy = clientY - lastMoveY

    const vx = (dx / dtMs) * 1000
    const vy = (dy / dtMs) * 1000

    // Simple low-pass filter for stability.
    const alpha = 0.35
    velX = velX * (1 - alpha) + vx * alpha
    velY = velY * (1 - alpha) + vy * alpha

    // Cap velocity defensively.
    const cap = Math.max(0, opts.momentumMaxVelocity)
    velX = clamp(velX, -cap, cap)
    velY = clamp(velY, -cap, cap)

    lastMoveTs = now
    lastMoveX = clientX
    lastMoveY = clientY
  }

  function maybeStartMomentum(): void {
    if (!opts.enableMomentum) return
    if (pointers.size !== 0) return
    if (g.isPinching) return

    const speed = Math.sqrt(velX * velX + velY * velY)
    if (
      !Number.isFinite(speed) ||
      speed < Math.max(0, opts.momentumMinVelocity)
    )
      return

    // Exponential decay: v(t+dt) = v(t) * exp(-friction * dt)
    const friction = Math.max(0, opts.momentumFriction)

    stopMomentum()
    let lastTs = performance.now()

    const step = () => {
      momentumRafId = window.requestAnimationFrame(step)

      const now = performance.now()
      const dt = Math.max(0, (now - lastTs) / 1000)
      lastTs = now
      if (dt <= 0) return

      const decay = Math.exp(-friction * dt)
      velX *= decay
      velY *= decay

      const speedNow = Math.sqrt(velX * velX + velY * velY)
      if (!Number.isFinite(speedNow) || speedNow < opts.momentumMinVelocity) {
        stopMomentum()
        return
      }

      t.tx += velX * dt
      t.ty += velY * dt
      scheduleEmit()
    }

    momentumRafId = window.requestAnimationFrame(step)
  }

  function onPointerDown(ev: PointerEvent): void {
    if (opts.preventDefault) ev.preventDefault()

    // Any new pointer interaction cancels inertia.
    stopMomentum()

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
    setGesturing(true)

    if (pointers.size === 1) {
      panStartX = ev.clientX
      panStartY = ev.clientY
      panStartTx = t.tx
      panStartTy = t.ty
      setPinching(false)

      // Reset velocity sampling
      lastMoveTs = 0
      recordPanVelocity(ev.clientX, ev.clientY)
    } else if (pointers.size === 2) {
      const [a, b] = Array.from(pointers.values())
      pinchStartDist = Math.max(1, dist(a, b))
      pinchStartScale = t.scale
      pinchStartTx = t.tx
      pinchStartTy = t.ty
      setPinching(true)

      const c = computeCentroid(a, b)
      // anchor at current centroid
      zoomAboutPoint(pinchStartScale, c.x, c.y)
    }
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
      t.tx = panStartTx + dx
      t.ty = panStartTy + dy

      recordPanVelocity(ev.clientX, ev.clientY)

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
      scheduleGestureOff()
      return
    }

    scheduleGestureOff()
  }

  function onPointerUpOrCancel(ev: PointerEvent): void {
    if (opts.preventDefault) ev.preventDefault()

    pointers.delete(ev.pointerId)

    if (opts.usePointerCapture) {
      try {
        container.releasePointerCapture(ev.pointerId)
      } catch {
        // ignore
      }
    }

    if (pointers.size === 0) {
      scheduleGestureOff()
      // Start inertia only when ending a single-pointer pan (not pinch).
      if (!g.isPinching) maybeStartMomentum()
      return
    }

    // Cancel inertia when there are still active pointers.
    stopMomentum()

    if (pointers.size === 1) {
      const [rem] = Array.from(pointers.values())
      panStartX = rem.x
      panStartY = rem.y
      panStartTx = t.tx
      panStartTy = t.ty
      setPinching(false)

      // Reset velocity sampling to remaining pointer.
      lastMoveTs = 0
      recordPanVelocity(rem.x, rem.y)

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
      scheduleGestureOff()
    }
  }

  function onWheel(ev: WheelEvent): void {
    if (!opts.enableWheelZoom) return
    if (opts.preventDefault) ev.preventDefault()

    // Wheel interaction cancels inertia to keep control predictable.
    stopMomentum()

    const dy = ev.deltaY
    if (!isFiniteNumber(dy) || dy === 0) return

    const factor = Math.exp(-dy * opts.wheelZoomSpeed)
    const nextScale = t.scale * factor

    setWheelZooming(true)
    scheduleWheelOff()

    zoomAboutPoint(nextScale, ev.clientX, ev.clientY)
  }

  const peOpts: AddEventListenerOptions = { passive: !opts.preventDefault }
  const wheelOpts: AddEventListenerOptions = { passive: false }

  container.addEventListener("pointerdown", onPointerDown, peOpts)
  container.addEventListener("pointermove", onPointerMove, peOpts)
  container.addEventListener("pointerup", onPointerUpOrCancel, peOpts)
  container.addEventListener("pointercancel", onPointerUpOrCancel, peOpts)
  container.addEventListener("wheel", onWheel, wheelOpts)

  emitTransform()
  emitGesture()

  return {
    destroy() {
      container.removeEventListener("pointerdown", onPointerDown)
      container.removeEventListener("pointermove", onPointerMove)
      container.removeEventListener("pointerup", onPointerUpOrCancel)
      container.removeEventListener("pointercancel", onPointerUpOrCancel)
      container.removeEventListener("wheel", onWheel)

      clearTimer(gestureOffTimer)
      clearTimer(wheelOffTimer)

      stopMomentum()

      if (rafId !== null) {
        window.cancelAnimationFrame(rafId)
        rafId = null
      }

      pointers.clear()
      g.isPinching = false
      g.isWheelZooming = false
      g.isGesturing = false
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

      // Programmatic changes should cancel inertia (predictability).
      stopMomentum()

      scheduleEmit()
    },

    reset() {
      stopMomentum()
      t.tx = 0
      t.ty = 0
      t.scale = clamp(1, opts.minScale, opts.maxScale)
      scheduleEmit()
    },
  }
}
