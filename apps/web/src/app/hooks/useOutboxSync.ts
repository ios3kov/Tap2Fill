// apps/web/src/app/hooks/useOutboxSync.ts
import { useCallback, useEffect, useRef } from "react"
import { putMeState, type MeState } from "../../lib/api"
import {
  clearPendingMeState,
  enqueueMeState,
  loadPendingMeState,
} from "../../local/outbox"
import { APP_CONFIG } from "../config/appConfig"

export function useOutboxSync(params: {
  enabled: boolean
  setServerState: (s: MeState | null) => void
}) {
  const { enabled, setServerState } = params

  const flushTimerRef = useRef<number | null>(null)
  const flushingRef = useRef(false)

  const clearFlushTimer = useCallback((): void => {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
  }, [])

  const flushOnce = useCallback(async (): Promise<void> => {
    if (!enabled) return
    if (flushingRef.current) return

    const pending = await loadPendingMeState()
    if (!pending) return

    flushingRef.current = true
    try {
      const res = await putMeState({
        lastPageId: pending.lastPageId,
        clientRev: pending.clientRev,
      })

      setServerState(res.state)

      // If server is ahead (or equal), local pending can be cleared safely.
      if (res.state && res.state.clientRev >= pending.clientRev) {
        await clearPendingMeState()
      }
    } catch {
      // Keep pending; retry later (best-effort outbox).
    } finally {
      flushingRef.current = false
    }
  }, [enabled, setServerState])

  /**
   * Schedule a flush after delayMs milliseconds.
   * - delayMs omitted => default APP_CONFIG.network.flushDelayMs
   * - delayMs = 0 => flush ASAP (next macrotask)
   *
   * IMPORTANT: explicit `number` type prevents TS from inferring a literal type
   * (e.g., 600) from APP_CONFIG if it was declared `as const`.
   */
  const scheduleFlush = useCallback(
    (delayMs: number = APP_CONFIG.network.flushDelayMs): void => {
      if (!enabled) return

      clearFlushTimer()

      const ms = Math.max(0, Math.trunc(delayMs))
      flushTimerRef.current = window.setTimeout(() => {
        flushTimerRef.current = null
        void flushOnce()
      }, ms)
    },
    [enabled, clearFlushTimer, flushOnce],
  )

  useEffect(() => {
    if (!enabled) return

    // Opportunistic flush on enable.
    void flushOnce()

    // Cleanup on disable/unmount.
    return () => {
      clearFlushTimer()
    }
  }, [enabled, flushOnce, clearFlushTimer])

  const enqueueAndSchedule = useCallback(
    async (
      pageId: string,
      clientRev: number,
      delayMs: number = APP_CONFIG.network.flushDelayMs,
    ): Promise<void> => {
      await enqueueMeState(pageId, clientRev)
      scheduleFlush(delayMs)
    },
    [scheduleFlush],
  )

  return { flushOnce, scheduleFlush, enqueueAndSchedule }
}
