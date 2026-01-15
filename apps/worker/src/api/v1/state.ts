import { Hono } from "hono";
import type { ParsedEnv } from "../../env";
import { requireTelegramAuth, type AuthContextVars } from "../../security/tgAuth";
import { getState, upsertStateIdempotent } from "../../db/state";

type Bindings = ParsedEnv;

export const stateApi = new Hono<{ Bindings: Bindings; Variables: AuthContextVars }>();

type MeStateDto = {
  userId: string;
  lastPageId: string | null;
  clientRev: number;
  updatedAt: number;
};

function toDto(row: {
  user_id: string;
  last_page_id: string | null;
  client_rev: number;
  updated_at: number;
} | null): MeStateDto | null {
  if (!row) return null;
  return {
    userId: String(row.user_id),
    lastPageId: row.last_page_id ?? null,
    clientRev: Number.isFinite(row.client_rev) ? Math.max(0, Math.trunc(row.client_rev)) : 0,
    updatedAt: Number.isFinite(row.updated_at) ? Math.trunc(row.updated_at) : 0,
  };
}

stateApi.get("/v1/me/state", requireTelegramAuth(), async (c) => {
  const userId = c.get("tgUserId");
  const row = await getState(c.env.DB, userId);
  return c.json({ ok: true, state: toDto(row) });
});

stateApi.put("/v1/me/state", requireTelegramAuth(), async (c) => {
  const userId = c.get("tgUserId");

  const body = await c.req
    .json<{ lastPageId?: string | null; clientRev?: number }>()
    .catch(() => null);

  if (!body) return c.json({ ok: false, error: "BAD_JSON" }, 400);

  // clientRev обязателен для idempotency
  const clientRev = Number(body.clientRev);
  if (!Number.isFinite(clientRev) || clientRev < 0) {
    return c.json({ ok: false, error: "CLIENT_REV_REQUIRED" }, 400);
  }

  const lastPageIdRaw = body.lastPageId ?? null;
  const lastPageId = lastPageIdRaw === null ? null : String(lastPageIdRaw).trim();

  if (lastPageId !== null && (lastPageId.length === 0 || lastPageId.length > 128)) {
    return c.json({ ok: false, error: "LAST_PAGE_ID_INVALID" }, 400);
  }

  // Idempotent upsert:
  // - если clientRev <= stored -> игнорируем
  // - если clientRev > stored -> пишем
  const saved = await upsertStateIdempotent(c.env.DB, userId, lastPageId, Math.trunc(clientRev));
  return c.json({ ok: true, state: toDto(saved) });
});