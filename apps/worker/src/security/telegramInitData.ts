type VerifyOk = {
  ok: true;
  authDate: number;
  userId?: number;
  raw: Record<string, string>;
};

type VerifyErr =
  | { ok: false; reason: "missing_init_data" }
  | { ok: false; reason: "missing_bot_token" }
  | { ok: false; reason: "malformed_init_data" }
  | { ok: false; reason: "missing_hash" }
  | { ok: false; reason: "expired" }
  | { ok: false; reason: "invalid_signature" };

const te = new TextEncoder();

function toHex(bytes: ArrayBuffer): string {
  const u8 = new Uint8Array(bytes);
  let out = "";
  for (let i = 0; i < u8.length; i++) out += u8[i]!.toString(16).padStart(2, "0");
  return out;
}

async function hmacSha256(keyBytes: Uint8Array, msg: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", key, te.encode(msg));
}

/**
 * Telegram Mini Apps initData verification (WebAppData).
 * Algorithm:
 * 1) data_check_string: sort params except "hash" by key, join as "k=v\n"
 * 2) secret_key = HMAC_SHA256(key="WebAppData", msg=botToken)
 * 3) signature = hex(HMAC_SHA256(key=secret_key, msg=data_check_string))
 * 4) signature must equal "hash"
 * 5) auth_date must be within maxAgeSec
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

  // Build raw map (decoded values, as URLSearchParams returns decoded strings)
  const raw: Record<string, string> = {};
  for (const [k, v] of params.entries()) raw[k] = v;

  // TTL check
  const authDateStr = params.get("auth_date");
  const authDate = authDateStr ? Number(authDateStr) : 0;
  if (!Number.isFinite(authDate) || authDate <= 0) return { ok: false, reason: "expired" };
  if (nowSec - authDate > maxAgeSec) return { ok: false, reason: "expired" };
  if (authDate - nowSec > 60) return { ok: false, reason: "expired" }; // clock skew guard

  // data_check_string
  const entries: Array<[string, string]> = [];
  for (const [k, v] of params.entries()) {
    if (k === "hash") continue;
    entries.push([k, v]);
  }
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");

  // secret_key = HMAC_SHA256("WebAppData", botToken)
  const secretKey = await hmacSha256(te.encode("WebAppData"), botToken);

  // signature = HMAC_SHA256(secretKey, data_check_string)
  const signature = await hmacSha256(new Uint8Array(secretKey), dataCheckString);
  const signatureHex = toHex(signature);

  if (signatureHex !== hash) return { ok: false, reason: "invalid_signature" };

  // optional user id
  let userId: number | undefined = undefined;
  const userRaw = params.get("user");
  if (userRaw) {
    try {
      const u = JSON.parse(userRaw) as { id?: number };
      if (typeof u.id === "number") userId = u.id;
    } catch {
      // ignore
    }
  }

  return { ok: true, authDate, userId, raw };
}
