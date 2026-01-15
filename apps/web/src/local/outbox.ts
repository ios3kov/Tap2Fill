import { kvDel, kvGet, kvSet } from "./snapshotKv";

export type PendingMeState = {
  schemaVersion: 1;
  lastPageId: string | null;
  clientRev: number;
  queuedAtMs: number;
};

const KEY = "t2f:v1:outbox:me_state";

export async function loadPendingMeState(): Promise<PendingMeState | null> {
  const v = await kvGet(KEY);
  if (!v || typeof v !== "object") return null;

  const o = v as Partial<PendingMeState>;
  if (o.schemaVersion !== 1) return null;
  if (typeof o.clientRev !== "number" || !Number.isFinite(o.clientRev)) return null;

  return {
    schemaVersion: 1,
    lastPageId: o.lastPageId ?? null,
    clientRev: Math.max(0, Math.trunc(o.clientRev)),
    queuedAtMs: typeof o.queuedAtMs === "number" ? o.queuedAtMs : Date.now(),
  };
}

export async function enqueueMeState(lastPageId: string | null, clientRev: number): Promise<void> {
  const pending: PendingMeState = {
    schemaVersion: 1,
    lastPageId,
    clientRev: Math.max(0, Math.trunc(clientRev)),
    queuedAtMs: Date.now(),
  };
  await kvSet(KEY, pending);
}

export async function clearPendingMeState(): Promise<void> {
  await kvDel(KEY);
}