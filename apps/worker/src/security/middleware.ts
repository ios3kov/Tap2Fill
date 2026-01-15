// apps/worker/src/security/middleware.ts
import type { Context, Next } from "hono";
import type { Env } from "../env";
import { verifyTelegramInitData } from "./telegramInitData";

function originOf(c: Context): string {
  return c.req.header("Origin") ?? "";
}

export function corsAllowlist() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const origin = originOf(c);
    const allow = c.env.WEBAPP_ORIGIN ?? "";

    if (origin && allow && origin === allow) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Vary", "Origin");
      c.header("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS");
      c.header("Access-Control-Allow-Headers", "Content-Type, X-Tg-Init-Data");
      c.header("Access-Control-Max-Age", "86400");
    }

    if (c.req.method.toUpperCase() === "OPTIONS") return c.body(null, 204);
    await next();
  };
}

export function payloadCap() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const maxBytes = Math.max(1024, Number(c.env.PAYLOAD_MAX_BYTES || "131072"));
    const len = Number(c.req.header("Content-Length") ?? "0");
    if (Number.isFinite(len) && len > maxBytes) return c.json({ error: "PAYLOAD_TOO_LARGE" }, 413);
    await next();
  };
}

async function rateLimitD1(c: Context<{ Bindings: Env }>): Promise<boolean> {
  if ((c.env.RATE_LIMIT_ENABLED ?? "0") !== "1") return true;

  const db = c.env.DB;
  if (!db) return true;

  const windowSec = Math.max(1, Number(c.env.RATE_LIMIT_WINDOW_SEC || "60"));
  const maxReq = Math.max(1, Number(c.env.RATE_LIMIT_MAX_REQUESTS || "120"));

  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const path = new URL(c.req.url).pathname;
  const key = `${ip}:${path}`;

  const nowSec = Math.floor(Date.now() / 1000);
  const windowStart = nowSec - (nowSec % windowSec);

  const row = await db
    .prepare(
      "INSERT INTO rate_limit_window(key, window_start, count) VALUES(?, ?, 1) " +
        "ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1 " +
        "RETURNING count",
    )
    .bind(key, windowStart)
    .first<{ count: number }>();

  const count = Number(row?.count ?? 1);
  return count <= maxReq;
}

export function rateLimit() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const ok = await rateLimitD1(c);
    if (!ok) return c.json({ error: "RATE_LIMITED" }, 429);
    await next();
  };
}

export function requireInitDataForWrites() {
  return async (c: Context<{ Bindings: Env; Variables: { userId?: string } }>, next: Next) => {
    const method = c.req.method.toUpperCase();
    const isWrite = method === "POST" || method === "PUT" || method === "DELETE" || method === "PATCH";
    if (!isWrite) return next();

    const initData = c.req.header("X-Tg-Init-Data") ?? "";
    const token = c.env.BOT_TOKEN ?? "";
    const maxAge = Math.max(0, Number(c.env.INITDATA_MAX_AGE_SEC || "3600"));

    const res = await verifyTelegramInitData(initData, token, maxAge);
    if (!res.ok) return c.json({ error: "UNAUTHORIZED", reason: res.reason }, 401);

    c.set("userId", res.userId);
    await next();
  };
}