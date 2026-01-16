// apps/web/src/app/hooks/useSvgPage.ts
import { useEffect, useMemo, useRef } from "react"
import { applyFillsToContainer, type FillMap } from "../coloring"
import { mountSvgIntoHost, type MountResult } from "../svgTapToFill"

export type UseSvgPageParams = Readonly<{
  enabled: boolean
  hostRef: React.MutableRefObject<HTMLDivElement | null>
  svgRaw: string
  fills: FillMap
  onMountError: (reason: string) => void
}>

export function useSvgPage(params: UseSvgPageParams): void {
  const { enabled, hostRef, svgRaw, fills, onMountError } = params

  // Keep latest fills in a ref so mount-effect doesn't depend on `fills`.
  const fillsRef = useRef<FillMap>({})
  useEffect(() => {
    fillsRef.current = fills
  }, [fills])

  const mountOptions = useMemo(
    () => ({
      requireViewBox: true,
      requireRegionIdPattern: true,
      regionIdPattern: /^R\d{3}$/,
      sanitize: true,
    }),
    [],
  )

  // 1) Mount SVG only when enabled/svgRaw/options change.
  useEffect(() => {
    if (!enabled) return

    const host = hostRef.current
    if (!host) return

    const res: MountResult = mountSvgIntoHost(host, svgRaw, mountOptions)
    if (!res.ok) {
      host.replaceChildren()
      onMountError(res.reason)
      return
    }

    // Apply the latest fills right after mount (without re-mounting on fills change).
    applyFillsToContainer(host, fillsRef.current)
  }, [enabled, svgRaw, hostRef, onMountError, mountOptions])

  // 2) Apply fills on every fills change (no remount).
  useEffect(() => {
    if (!enabled) return
    const host = hostRef.current
    if (!host) return
    applyFillsToContainer(host, fills)
  }, [enabled, hostRef, fills])
}