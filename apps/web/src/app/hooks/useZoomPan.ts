// apps/web/src/app/hooks/useZoomPan.ts
import { useEffect } from "react"
import {
  attachZoomPan,
  type Transform as ZoomPanTransform,
} from "../viewport/zoomPan"

export function applyTransformStyle(
  el: HTMLElement,
  t: ZoomPanTransform,
): void {
  el.style.transform = `translate3d(${t.tx}px, ${t.ty}px, 0) scale(${t.scale})`
}

export function useZoomPan(params: {
  enabled: boolean
  containerRef: React.MutableRefObject<HTMLDivElement | null>
  contentRef: React.MutableRefObject<HTMLDivElement | null>
  transform: ZoomPanTransform
  setTransform: (t: ZoomPanTransform) => void
  setIsGesturing: (v: boolean) => void
}) {
  useEffect(() => {
    if (!params.enabled) return

    const container = params.containerRef.current
    const content = params.contentRef.current
    if (!container || !content) return

    // Apply once
    applyTransformStyle(content, params.transform)

    const zp = attachZoomPan(container, {
      initial: params.transform,
      onTransform: (t) => {
        const el = params.contentRef.current
        if (el) applyTransformStyle(el, t)
        params.setTransform(t)
      },
      onGestureState: (s) =>
        params.setIsGesturing(Boolean(s.isGesturing || s.isWheelZooming)),
    })

    return () => {
      zp.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.enabled, params.containerRef, params.contentRef])
}
