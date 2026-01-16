// apps/web/src/app/hooks/useServerRestore.ts
import { useEffect, useRef } from "react"
import { getMeState } from "../../lib/api"
import { saveLastPageId } from "../../local/snapshot"
import { normalizePageId } from "../domain/guards"
import { APP_CONFIG } from "../config/appConfig"

/**
 * Server restore (Stage 3+)
 *
 * Responsibilities:
 * - Fetch server-visible user state (lastPageId, clientRev).
 * - Optionally navigate to server lastPageId on first load (local-first safe).
 * - If server clientRev is ahead of local, reconcile without corrupting local progress.
 *
 * Key correctness rule:
 * - We MUST NOT "advance" local clientRev to a higher serverRev unless we also have the
 *   corresponding progress state. Otherwise we create an inconsistent snapshot:
 *   new revision number + old progress bytes (data loss on next sync).
 *
 * Therefore:
 * - If serverRev > localRev, we ask caller to persist a snapshot using current local refs
 *   but with nextClientRev = localRev + 1 (monotonic, safe), NOT serverRev.
 * - We still expose server state to UI (debug panel) so the discrepancy is visible.
 *
 * Safety:
 * - cancelable async effect
 * - navigation freshness guard (user may have navigated while request was in flight)
 * - simple throttling to avoid repeated calls in slow environments
 */
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

  /**
   * Called when server is ahead of local.
   * IMPORTANT: The implementation should persist using current local refs.
   * This hook will pass a safe nextClientRev (monotonic local), not the serverRev.
   */
  persistWhenServerAhead: (nextClientRev: number) => Promise<void>
}) {
  const lastFetchAtRef = useRef<number>(0)

  useEffect(() => {
    let cancelled = false

    const run = async (): Promise<void> => {
      if (!params.enabled) return

      // Minimal throttle: avoid bursts if enabled flips or WebView is noisy.
      const now = Date.now()
      if (now - lastFetchAtRef.current < 1_000) return
      lastFetchAtRef.current = now

      const requestLastPageId = params.lastPageId

      try {
        const res = await getMeState()
        if (cancelled) return

        params.setServerState(res.state)

        const st = res.state
        if (!st) return

        const normalizedServerPageId = normalizePageId(
          st.lastPageId,
          APP_CONFIG.limits.pageIdMaxLen,
        )

        // Navigation: only auto-navigate if user hasn't chosen a page locally
        // AND lastPageId didn't change while the request was in flight.
        if (
          !requestLastPageId &&
          !params.lastPageId &&
          normalizedServerPageId
        ) {
          params.setLastPageId(normalizedServerPageId)
          params.setRoute({ name: "page", pageId: normalizedServerPageId })
          await saveLastPageId(normalizedServerPageId)
        }

        const localRev = params.clientRevRef.current
        const serverRev =
          typeof st.clientRev === "number" && Number.isFinite(st.clientRev)
            ? Math.max(0, Math.trunc(st.clientRev))
            : 0

        // Reconciliation:
        // If server is ahead, we must not jump localRev to serverRev without also having server progress.
        // The safe move: keep localRev monotonic and let outbox/server sync converge later.
        if (serverRev > localRev) {
          const safeNextLocalRev = localRev + 1
          params.setClientRev(safeNextLocalRev)
          await params.persistWhenServerAhead(safeNextLocalRev)
          return
        }

        // Optional: if local is behind/equal, no action needed here.
      } catch {
        // local-first: ignore network issues
      }
    }

    void run()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.enabled])
}