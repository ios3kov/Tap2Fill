// apps/web/src/app/hooks/useBootstrap.ts
import { useEffect, useState } from "react"
import { tmaBootstrap } from "../../lib/tma"
import { ensureSvgPointerPolicyStyle } from "../svgTapToFill"
import { APP_CONFIG } from "../config/appConfig"

/**
 * One-time bootstrap side effects:
 * - Telegram Mini App bootstrap
 * - Global SVG pointer policy style injection
 * - A short-lived tick to re-render during first seconds (useful for initData label updates)
 */
export function useBootstrap(): { tick: number } {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const cleanup = tmaBootstrap()
    ensureSvgPointerPolicyStyle()

    const id = window.setInterval(
      () => setTick((t) => t + 1),
      APP_CONFIG.ui.bootstrapTickMs,
    )
    window.setTimeout(
      () => window.clearInterval(id),
      APP_CONFIG.ui.bootstrapTickTotalMs,
    )

    return () => {
      window.clearInterval(id)
      cleanup?.()
    }
  }, [])

  return { tick }
}
