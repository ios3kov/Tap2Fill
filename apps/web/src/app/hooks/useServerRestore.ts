// apps/web/src/app/hooks/useServerRestore.ts
import { useEffect } from "react"
import { getMeState } from "../../lib/api"
import { saveLastPageId } from "../../local/snapshot"
import { normalizePageId } from "../domain/guards"
import { APP_CONFIG } from "../config/appConfig"

export function useServerRestore(params: {
  enabled: boolean
  lastPageId: string | null
  setLastPageId: (v: string | null) => void
  setRoute: (r: { name: "gallery" } | { name: "page"; pageId: string }) => void
  setServerState: (
    s: { lastPageId: string | null; clientRev: number } | null,
  ) => void

  clientRevRef: React.MutableRefObject<number>
  setClientRev: (v: number) => void

  // If serverRev > local, persist a snapshot with current local refs.
  persistWhenServerAhead: (nextClientRev: number) => Promise<void>
}) {
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!params.enabled) return

      try {
        const res = await getMeState()
        if (cancelled) return

        params.setServerState(res.state)

        const st = res.state
        if (!st) return

        const normalized = normalizePageId(
          st.lastPageId,
          APP_CONFIG.limits.pageIdMaxLen,
        )

        if (!params.lastPageId && normalized) {
          params.setLastPageId(normalized)
          params.setRoute({ name: "page", pageId: normalized })
          await saveLastPageId(normalized)
        }

        if (st.clientRev > params.clientRevRef.current) {
          const nextClientRev = st.clientRev
          params.setClientRev(nextClientRev)
          await params.persistWhenServerAhead(nextClientRev)
        }
      } catch {
        // ignore; local-first
      }
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.enabled])
}
