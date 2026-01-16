// apps/web/src/sync/batchedSync.ts
// Batched sync: push local monotonic state to server (idempotent by clientRev)
// and optionally pull/restore if server is newer.
// This module is intentionally UI-agnostic: it returns status and can be wired to any UI.

import { getMeState, putMeState, type MeState } from "../lib/api"
import { loadLastPageId, saveLastPageId } from "../local/snapshot"

export type SyncStatus =
  | { kind: "idle" }
  | { kind: "running"; atMs: number }
  | { kind: "ok"; atMs: number; clientRev: number; lastPageId: string | null }
  | { kind: "error"; atMs: number; error: string }

export type BatchedSyncOptions = {
  /**
   * Read current local monotonic revision.
   * Must be monotonic per device.
   */
  getLocalClientRev: () => number

  /**
   * Provide current local lastPageId (may be null).
   * If you do not have it in state, you can read from IndexedDB snapshot (loadLastPageId()).
   */
  getLocalLastPageId?: () => string | null

  /**
   * Apply server restore to local.
   * This is called only when server state is newer (serverRev > localRev).
   * You decide how to restore (e.g., setState + saveLastPageId + load page snapshot).
   */
  applyServerRestore?: (server: MeState) => Promise<void>

  /**
   * Optional: throttle/merge repeated calls at app level.
   */
  maxPutPerRun?: number
}

function errToString(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e ?? "Unknown error")
}

/**
 * Run one batched sync cycle.
 * - GET server state
 * - If server newer -> restore (optional)
 * - Else PUT local state with clientRev (idempotent)
 */
export async function runBatchedSync(
  opts: BatchedSyncOptions,
): Promise<SyncStatus> {
  const startedAt = Date.now()

  try {
    // 1) Read local
    const localRev = Math.max(0, Math.trunc(opts.getLocalClientRev() ?? 0))
    const localLast =
      (opts.getLocalLastPageId ? opts.getLocalLastPageId() : null) ??
      (await loadLastPageId())

    // 2) Read server (may be null)
    const s0 = await getMeState()
    const server = s0.state
    const serverRev = server?.clientRev ?? 0

    // 3) If server newer -> restore (optional)
    if (server && serverRev > localRev) {
      if (opts.applyServerRestore) {
        await opts.applyServerRestore(server)
      } else {
        // Minimal restore: lastPageId only (keeps local data consistent across devices)
        await saveLastPageId(server.lastPageId ?? null)
      }

      return {
        kind: "ok",
        atMs: Date.now(),
        clientRev: serverRev,
        lastPageId: server.lastPageId ?? null,
      }
    }

    // 4) Push local to server (idempotent by clientRev)
    // If there is no initData (outside TMA), server will likely reject; caller can decide.
    const res = await putMeState({
      lastPageId: localLast ?? null,
      clientRev: localRev,
    })

    // server may still respond with null (depending on API). Treat as rev=localRev.
    const pushedRev = res.state?.clientRev ?? localRev
    const pushedLast = res.state?.lastPageId ?? localLast ?? null

    // Keep local lastPageId aligned to what server returns (canonical)
    await saveLastPageId(pushedLast)

    return {
      kind: "ok",
      atMs: Date.now(),
      clientRev: pushedRev,
      lastPageId: pushedLast,
    }
  } catch (e) {
    return { kind: "error", atMs: Date.now(), error: errToString(e) }
  } finally {
    // no-op; reserved for future instrumentation
    void startedAt
  }
}
