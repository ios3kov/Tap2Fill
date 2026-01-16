// apps/web/src/app/hooks/useSvgPage.ts
import { useEffect, useMemo } from "react"
import { applyFillsToContainer, type FillMap } from "../coloring"
import { mountSvgIntoHost, type MountResult } from "../svgTapToFill"

export type UseSvgPageParams = Readonly<{
  enabled: boolean
  hostRef: React.MutableRefObject<HTMLDivElement | null>
  svgRaw: string
  fills: FillMap
  onMountError: (reason: string) => void
}>

/**
 * useSvgPage
 * - Mounts sanitized SVG into a host container when enabled/svg change.
 * - Applies fills whenever they change.
 * - Uses destructured params to satisfy exhaustive-deps and keep effects explicit.
 */
export function useSvgPage(params: UseSvgPageParams): void {
  const { enabled, hostRef, svgRaw, fills, onMountError } = params

  // Memoize options so the effect dependencies remain stable and explicit.
  const mountOptions = useMemo(
    () => ({
      requireViewBox: true,
      requireRegionIdPattern: true,
      regionIdPattern: /^R\d{3}$/,
      sanitize: true,
    }),
    [],
  )

  // Mount once per "enabled" and svg source.
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

    // Ensure initial fills are applied immediately after a successful mount.
    applyFillsToContainer(host, fills)
  }, [enabled, hostRef, svgRaw, onMountError, mountOptions, fills])

  // Apply fills when they change (only if already mounted).
  useEffect(() => {
    if (!enabled) return

    const host = hostRef.current
    if (!host) return

    applyFillsToContainer(host, fills)
  }, [enabled, hostRef, fills])
}