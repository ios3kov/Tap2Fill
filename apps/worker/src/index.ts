import { Hono } from "hono";
import type { Env } from "./env";
import { api } from "./api/routes";
import { corsAllowlist, payloadCap, rateLimit, requireInitDataForWrites } from "./security/middleware";
import { handleBotWebhook } from "./bot/webhook";

const app = new Hono<{ Bindings: Env; Variables: { userId?: string } }>();

// Global hardening
app.use("*", corsAllowlist());
app.use("*", payloadCap());
app.use("*", rateLimit());

// Bot webhook: Telegram will POST here. Do NOT require initData.
// Protect with a secret path segment to prevent random hits.
app.post("/bot/webhook/:secret", async (c) => {
  const secret = c.req.param("secret");
  if (!secret || secret !== c.env.WEBHOOK_SECRET) {
    return c.json({ error: "NOT_FOUND" }, 404);
  }
  return handleBotWebhook(c.req.raw, c.env);
});

// API: initData required for writes (PUT/POST/DELETE/PATCH)
app.use("*", requireInitDataForWrites());
app.route("/", api);

export default app;
