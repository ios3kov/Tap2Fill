import type { Context, Next } from "hono";
import type { Env } from "../env";

type VerifyResult =
  | { ok: true; userId: number; authDate: number }
  | { ok: false; reason: string };

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  if (clean.length % 2 !== 0) throw new Error("hex length must be even");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function hmacSha256(key: Uint8Array, data: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

/**
 * Telegram Mini App initData verification.
 * Algorithm:
 * 1) Parse initData as querystring.
 * 2) data_check_string = sorted pairs (key=value), excluding "hash", joined by "\n"
 * 3) secret_key = HMAC_SHA256(key="WebAppData", data=bot_token)
 * 4) expected_hash = HMAC_SHA256(key=secret_key, data=data_check_string) as hex
 */
export async function verifyTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSec: number,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<VerifyResult> {
  if (!initData || initData.length < 10) return { ok: false, reason: "initData missing" };

  const params = new URLSearchParams(initData);
  const providedHash = params.get("hash") ?? "";
  if (!providedHash) return { ok: false, reason: "hash missing" };

  // TTL check
  const authDateStr = params.get("auth_date") ?? "";
  const authDate = Number.parseInt(authDateStr, 10);
  if (!Number.isFinite(authDate)) return { ok: false, reason: "auth_date invalid" };
  if (maxAgeSec > 0 && nowSec - authDate > maxAgeSec) return { ok: false, reason: "initData expired" };

  // Build data_check_string
  const pairs: string[] = [];
  params.forEach((value, key) => {
    if (key === "hash") return;
    pairs.push(`${key}=${value}`);
  });
  pairs.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const dataCheckString = pairs.join("\n");

  const secretKey = await hmacSha256(new TextEncoder().encode("WebAppData"), botToken);
  const expectedHashHex = bytesToHex(await hmacSha256(secretKey, dataCheckString));

  if (expectedHashHex !== providedHash) return { ok: false, reason: "hash mismatch" };

  // Extract user id from "user" JSON
  const userJson = params.get("user");
  if (!userJson) return { ok: false, reason: "user missing" };

  let userId: number | null = null;
  try {
    const u = JSON.parse(userJson) as { id?: unknown };
    const id = typeof u.id === "number" ? u.id : Number(u.id);
    if (Number.isFinite(id)) userId = id;
  } catch {
    userId = null;
  }
  if (!userId) return { ok: false, reason: "user.id invalid" };

  return { ok: true, userId, authDate };
}

export type AuthContextVars = {
  tgUserId: number;
};

function getInitDataFromRequest(req: Request): string {
  // Standard header for the Mini App client
  const h = req.headers.get("x-tg-init-data") ?? "";
  if (h) return h;

  // Fallback for debugging
  const url = new URL(req.url);
  return url.searchParams.get("initData") ?? "";
}

export function requireTelegramAuth() {
  return async (c: Context<{ Bindings: Env; Variables: AuthContextVars }>, next: Next) => {
    const initData = getInitDataFromRequest(c.req.raw);
    const botToken = c.env.BOT_TOKEN;
    const maxAge = c.env.INITDATA_MAX_AGE_SEC_NUM;

    const res = await verifyTelegramInitData(initData, botToken, maxAge);
    if (!res.ok) {
      return c.json({ ok: false, error: "UNAUTHORIZED", reason: res.reason }, 401);
    }

    c.set("tgUserId", res.userId);
    await next();
  };
}
