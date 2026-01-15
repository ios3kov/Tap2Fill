import { Hono } from "hono";
import type { ParsedEnv } from "../../env";
import { requireTelegramAuth, type AuthContextVars } from "../../security/tgAuth";
import { getState, upsertState } from "../../db/state";

type Bindings = ParsedEnv;

export const stateApi = new Hono<{ Bindings: Bindings; Variables: AuthContextVars }>();

stateApi.get("/v1/me/state", requireTelegramAuth(), async (c) => {
  const userId = c.get("tgUserId");
  const row = await getState(c.env.DB, userId);
  return c.json({ ok: true, state: row });
});

stateApi.put("/v1/me/state", requireTelegramAuth(), async (c) => {
  const userId = c.get("tgUserId");

  const body = await c.req.json<{ lastPageId?: string | null }>().catch(() => null);
  if (!body) return c.json({ ok: false, error: "BAD_JSON" }, 400);

  const lastPageIdRaw = body.lastPageId ?? null;
  const lastPageId = lastPageIdRaw === null ? null : String(lastPageIdRaw).trim();

  // Keep it bounded and safe.
  if (lastPageId !== null && (lastPageId.length === 0 || lastPageId.length > 128)) {
    return c.json({ ok: false, error: "LAST_PAGE_ID_INVALID" }, 400);
  }

  const saved = await upsertState(c.env.DB, userId, lastPageId);
  return c.json({ ok: true, state: saved });
});
