import { getInitData } from "./tma";

const API_BASE = "https://tap2fill-worker.os3kov.workers.dev";

type ApiOk<T> = { ok: true } & T;
type ApiErr = { ok: false; error: string; reason?: string };

function mergeHeaders(a?: HeadersInit, b?: HeadersInit): Headers {
  const h = new Headers(a);
  if (b) {
    const hb = new Headers(b);
    hb.forEach((v, k) => h.set(k, v));
  }
  return h;
}

async function httpJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = mergeHeaders(
    {
      "content-type": "application/json",
      "x-tg-init-data": getInitData(),
    },
    init?.headers,
  );

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const text = await res.text();

  // Try to parse JSON response, but do not fail if body is not JSON.
  const maybeJson = (() => {
    try {
      return text ? (JSON.parse(text) as unknown) : null;
    } catch {
      return null;
    }
  })();

  if (!res.ok) {
    // If API returns structured error, surface it.
    if (maybeJson && typeof maybeJson === "object") {
      const err = maybeJson as Partial<ApiErr>;
      const msg = err.error
        ? `HTTP ${res.status}: ${err.error}${err.reason ? ` (${err.reason})` : ""}`
        : `HTTP ${res.status}: ${text}`;
      throw new Error(msg);
    }
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  return (maybeJson ?? ({} as unknown)) as T;
}

/**
 * Raw state as it may come from server (snake_case today, may become camelCase later).
 * Keep compatibility to avoid breaking deploys.
 */
export type MeStateRaw = {
  user_id?: string;
  last_page_id?: string | null;
  client_rev?: number;
  updated_at?: number;

  // future-proof: if you switch API to canonical camelCase later
  userId?: string;
  lastPageId?: string | null;
  clientRev?: number;
  updatedAt?: number;
};

export type MeState = {
  userId: string;
  lastPageId: string | null;
  clientRev: number;
  updatedAt: number;
};

function toStringSafe(v: unknown): string {
  return typeof v === "string" ? v : String(v ?? "");
}

function toIntSafe(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/**
 * Normalize server payload into canonical client shape.
 * - Works with both snake_case and camelCase.
 * - Ensures clientRev is always a number (>=0).
 */
export function normalizeMeState(raw: MeStateRaw | null): MeState | null {
  if (!raw) return null;

  const userId = (raw.userId ?? raw.user_id) as unknown;
  const lastPageId = (raw.lastPageId ?? raw.last_page_id) as unknown;
  const clientRev = (raw.clientRev ?? raw.client_rev) as unknown;
  const updatedAt = (raw.updatedAt ?? raw.updated_at) as unknown;

  // userId must exist; if not, treat as invalid payload.
  const uid = toStringSafe(userId).trim();
  if (!uid) return null;

  return {
    userId: uid,
    lastPageId: lastPageId == null ? null : toStringSafe(lastPageId).trim() || null,
    clientRev: Math.max(0, toIntSafe(clientRev)),
    updatedAt: toIntSafe(updatedAt),
  };
}

export function hasTelegramInitData(): boolean {
  return getInitData().trim().length > 0;
}

/**
 * GET /v1/me/state
 * Server may return null state if not created yet.
 */
export async function getMeState() {
  const res = await httpJson<ApiOk<{ state: MeStateRaw | null }>>("/v1/me/state", { method: "GET" });
  return { ok: true as const, state: normalizeMeState(res.state) };
}

/**
 * PUT /v1/me/state
 * - lastPageId: string|null
 * - clientRev: number (required with idempotency)
 */
export async function putMeState(args: { lastPageId: string | null; clientRev: number }) {
  const res = await httpJson<ApiOk<{ state: MeStateRaw | null }>>("/v1/me/state", {
    method: "PUT",
    body: JSON.stringify(args),
  });
  return { ok: true as const, state: normalizeMeState(res.state) };
}