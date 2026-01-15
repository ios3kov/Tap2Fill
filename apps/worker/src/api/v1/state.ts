import { Hono } from "hono";
import type { ParsedEnv } from "../../env";
import { requireTelegramAuth, type AuthContextVars } from "../../security/tgAuth";
import { getState, upsertState } from "../../db/state";
import { normalizeUserId } from "../../util/userId";

type Bindings = ParsedEnv;

export const stateApi = new Hono<{ Bindings: Bindings; Variables: AuthContextVars }>();

stateApi.get("/v1/me/state", requireTelegramAuth(), async (c) => {
  const rawUserId = c.get("tgUserId");
  const userId = normalizeUserId(rawUserId);

  const row = await getState(c.env.DB, userId);

  // Ensure response always carries normalized user_id (even if DB has legacy "123.0").
  const state = row ? { ...row, user_id: normalizeUserId(row.user_id) } : null;

  return c.json({ ok: true, state });
});

stateApi.put("/v1/me/state", requireTelegramAuth(), async (c) => {
  const rawUserId = c.get("tgUserId");
  const userId = normalizeUserId(rawUserId);

  const body = await c.req.json<{ lastPageId?: string | null }>().catch(() => null);
  if (!body) return c.json({ ok: false, error: "BAD_JSON" }, 400);

  const lastPageIdRaw = body.lastPageId ?? null;
  const lastPageId = lastPageIdRaw === null ? null : String(lastPageIdRaw).trim();

  if (lastPageId !== null && (lastPageId.length === 0 || lastPageId.length > 128)) {
    return c.json({ ok: false, error: "LAST_PAGE_ID_INVALID" }, 400);
  }

  const saved = await upsertState(c.env.DB, userId, lastPageId);

  // Normalize on the way out as well.
  const state = { ...saved, user_id: normalizeUserId(saved.user_id) };

  return c.json({ ok: true, state });
});