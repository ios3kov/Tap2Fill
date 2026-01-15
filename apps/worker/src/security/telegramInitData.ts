// apps/worker/src/security/telegramInitData.ts
import { normalizeUserId } from "../util/userId";

export type VerifyOk = {
  ok: true;
  authDate: number;
  userId: string; // canonical digits-only
  raw: Record<string, string>;
};

export type VerifyErr =
  | { ok: false; reason: "missing_init_data" }
  | { ok: false; reason: "missing_bot_token" }
  | { ok: false; reason: "malformed_init_data" }
  | { ok: false; reason: "missing_hash" }
  | { ok: false; reason: "expired" }
  | { ok: false; reason: "invalid_signature" }
  | { ok: false; reason: "missing_user" }
  | { ok: false; reason: "invalid_user_id" };

const te = new TextEncoder();

function toHex(bytes: ArrayBuffer): string {
  const u8 = new Uint8Array(bytes);
  let out = "";
  for (let i = 0; i < u8.length; i++) {
    const b = u8[i];
    if (b === undefined) continue;
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
}

async function hmacSha256(keyBytes: Uint8Array, msg: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(keyBytes),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const data = te.encode(msg);
  return crypto.subtle.sign("HMAC", key, toArrayBuffer(data));
}

function buildRawMap(params: URLSearchParams): Record<string, string> {
  const raw: Record<string, string> = {};
  params.forEach((v, k) => {
    raw[k] = v;
  });
  return raw;
}

function buildDataCheckString(params: URLSearchParams): string {
  const pairs: string[] = [];
  params.forEach((v, k) => {
    if (k === "hash") return;
    pairs.push(`${k}=${v}`);
  });
  pairs.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return pairs.join("\n");
}

/**
 * Telegram Mini Apps initData verification (WebAppData).
 */
export async function verifyTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSec: number,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<VerifyOk | VerifyErr> {
  if (!initData || !String(initData).trim()) return { ok: false, reason: "missing_init_data" };
  if (!botToken || !String(botToken).trim()) return { ok: false, reason: "missing_bot_token" };

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, reason: "malformed_init_data" };
  }

  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "missing_hash" };

  const raw = buildRawMap(params);

  // TTL check
  const authDateStr = params.get("auth_date");
  const authDate = authDateStr ? Number(authDateStr) : 0;
  if (!Number.isFinite(authDate) || authDate <= 0) return { ok: false, reason: "expired" };

  const maxAge = Math.max(0, Number(maxAgeSec || 0));
  if (maxAge > 0 && nowSec - authDate > maxAge) return { ok: false, reason: "expired" };

  // Clock skew guard
  if (authDate - nowSec > 60) return { ok: false, reason: "expired" };

  const dataCheckString = buildDataCheckString(params);

  const secretKey = await hmacSha256(te.encode("WebAppData"), botToken);
  const signature = await hmacSha256(new Uint8Array(secretKey), dataCheckString);
  const signatureHex = toHex(signature);

  if (signatureHex !== hash.toLowerCase()) return { ok: false, reason: "invalid_signature" };

  const userRaw = params.get("user");
  if (!userRaw) return { ok: false, reason: "missing_user" };

  let userId = "";
  try {
    const u = JSON.parse(userRaw) as { id?: unknown };
    userId = normalizeUserId(u?.id);
  } catch {
    userId = "";
  }
  if (!userId) return { ok: false, reason: "invalid_user_id" };

  return { ok: true, authDate, userId, raw };
}