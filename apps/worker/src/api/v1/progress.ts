// apps/worker/src/api/v1/progress.ts
import { Hono } from "hono";
import type { ParsedEnv } from "../../env";
import { requireTelegramAuth, type AuthContextVars } from "../../security/tgAuth";
import { getProgress, upsertProgressIdempotent } from "../../db/progress";

type Bindings = ParsedEnv;

function isBase64(s: string): boolean {
  return /^[A-Za-z0-9+/=]+$/.test(s) && s.length <= 200000;
}

export const progressApi = new Hono<{ Bindings: Bindings; Variables: AuthContextVars }>();

progressApi.get("/v1/progress/:pageId", requireTelegramAuth(), async (c) => {
  const userId = c.get("tgUserId"); // string
  const pageId = c.req.param("pageId");

  const row = await getProgress(c.env.DB, userId, pageId);
  return c.json({ ok: true, progress: row });
});

progressApi.put("/v1/progress/:pageId", requireTelegramAuth(), async (c) => {
  const userId = c.get("tgUserId"); // string
  const pageId = c.req.param("pageId");

  const body = await c
    .req.json<{
      contentHash: string;
      clientRev: number;
      dataB64: string;
      timeSpentSec?: number;
    }>()
    .catch(() => null);

  if (!body) return c.json({ ok: false, error: "BAD_JSON" }, 400);

  const contentHash = String(body.contentHash ?? "").trim();
  const clientRev = Number(body.clientRev);
  const dataB64 = String(body.dataB64 ?? "").trim();
  const timeSpentSec = Number.isFinite(body.timeSpentSec) ? Math.max(0, Math.floor(Number(body.timeSpentSec))) : 0;

  if (!contentHash) return c.json({ ok: false, error: "CONTENT_HASH_REQUIRED" }, 400);
  if (!Number.isInteger(clientRev) || clientRev < 0) return c.json({ ok: false, error: "CLIENT_REV_INVALID" }, 400);
  if (!dataB64 || !isBase64(dataB64)) return c.json({ ok: false, error: "DATA_INVALID" }, 400);

  const saved = await upsertProgressIdempotent(c.env.DB, {
    user_id: userId,
    page_id: pageId,
    content_hash: contentHash,
    client_rev: clientRev,
    data_b64: dataB64,
    time_spent_sec: timeSpentSec,
  });

  return c.json({ ok: true, progress: saved });
});