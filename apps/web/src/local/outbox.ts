// apps/web/src/local/outbox.ts
/**
 * Outbox for batched sync (client → server).
 *
 * Two layers:
 * 1) Generic queue (outboxEnqueue/outboxPeek/outboxDrain) for future batching.
 * 2) Compatibility helpers for current app flows:
 *    - enqueueMeState(lastPageId, clientRev)
 *    - loadPendingMeState()
 *    - clearPendingMeState()
 *
 * Notes:
 * - Idempotency is enforced server-side via monotonic clientRev.
 * - Local queue may deliver duplicates after crashes; server must tolerate it.
 */

import { kvDel, kvGet, kvSet } from "./snapshotKv";

export type PendingMeState = {
  lastPageId: string | null;
  clientRev: number;
};

export type OutboxItemV1 =
  | {
      kind: "me_state";
      schemaVersion: 1;
      atMs: number;
      payload: PendingMeState;
    }
  | {
      kind: "progress";
      schemaVersion: 1;
      atMs: number;
      payload: {
        pageId: string;
        contentHash: string;
        clientRev: number;
        dataB64: string;
        timeSpentSec: number;
      };
    };

type OutboxStoreV1 = {
  schemaVersion: 1;
  items: OutboxItemV1[];
};

const OUTBOX_KEY = "outbox_v1";
const PENDING_ME_STATE_KEY = "pending_me_state_v1";

function ensureStore(v: unknown): OutboxStoreV1 {
  if (!v || typeof v !== "object") return { schemaVersion: 1, items: [] };
  const anyV = v as Partial<OutboxStoreV1>;
  if (anyV.schemaVersion !== 1 || !Array.isArray(anyV.items)) return { schemaVersion: 1, items: [] };
  return { schemaVersion: 1, items: anyV.items as OutboxItemV1[] };
}

/**
 * Append an item to outbox (best effort).
 */
export async function outboxEnqueue(item: OutboxItemV1): Promise<void> {
  const cur = ensureStore(await kvGet<OutboxStoreV1>(OUTBOX_KEY));
  cur.items.push(item);
  await kvSet(OUTBOX_KEY, cur);
}

/**
 * Peek items without clearing.
 */
export async function outboxPeek(): Promise<OutboxItemV1[]> {
  const cur = ensureStore(await kvGet<OutboxStoreV1>(OUTBOX_KEY));
  return cur.items;
}

/**
 * Drain items: read and clear (best effort).
 * If clearing fails, we still return items (caller should tolerate duplicates).
 */
export async function outboxDrain(): Promise<OutboxItemV1[]> {
  const cur = ensureStore(await kvGet<OutboxStoreV1>(OUTBOX_KEY));

  const cleared = await kvDel(OUTBOX_KEY);
  if (!cleared) {
    // fallback: overwrite with empty store
    await kvSet(OUTBOX_KEY, { schemaVersion: 1, items: [] });
  }

  return cur.items;
}

/* ------------------------------------------------------------------------------------------
 * Compatibility layer for the current "me/state" flow (single pending write).
 * ---------------------------------------------------------------------------------------- */

/**
 * Store the latest pending /v1/me/state write.
 * Keeps UI contract: enqueueMeState(lastPageId, clientRev).
 * Coalesces multiple writes into the newest one (efficiency).
 */
export async function enqueueMeState(lastPageId: string | null, clientRev: number): Promise<void> {
  const payload: PendingMeState = {
    lastPageId: lastPageId == null ? null : String(lastPageId),
    clientRev: Math.max(0, Math.trunc(Number(clientRev))),
  };

  // 1) Save as "pending" (single item)
  await kvSet(PENDING_ME_STATE_KEY, payload);

  // 2) Also enqueue into generic outbox (optional for future batched sync).
  // If we later drain outbox, server idempotency makes duplicates safe.
  await outboxEnqueue({
    kind: "me_state",
    schemaVersion: 1,
    atMs: Date.now(),
    payload,
  });
}

/**
 * Load pending /v1/me/state write (if any).
 */
export async function loadPendingMeState(): Promise<PendingMeState | null> {
  const v = await kvGet<unknown>(PENDING_ME_STATE_KEY);
  if (!v || typeof v !== "object") return null;

  const anyV = v as Partial<PendingMeState>;
  const lastPageId = anyV.lastPageId ?? null;
  const clientRev = anyV.clientRev;

  if (!Number.isFinite(Number(clientRev))) return null;

  return {
    lastPageId: lastPageId == null ? null : String(lastPageId),
    clientRev: Math.max(0, Math.trunc(Number(clientRev))),
  };
}

/**
 * Clear pending /v1/me/state write.
 */
export async function clearPendingMeState(): Promise<void> {
  await kvDel(PENDING_ME_STATE_KEY);

  // Hygiene: compact generic outbox by removing older me_state entries.
  // Keep other kinds (progress) intact.
  const cur = ensureStore(await kvGet<OutboxStoreV1>(OUTBOX_KEY));
  if (cur.items.length === 0) return;

  const kept = cur.items.filter((it) => it.kind !== "me_state");
  if (kept.length !== cur.items.length) {
    await kvSet(OUTBOX_KEY, { schemaVersion: 1, items: kept });
  }
}