import { hmacSha256, timingSafeEqual, toHex, utf8 } from "./crypto"

function parseQuery(qs: string): Map<string, string> {
  const out = new Map<string, string>()
  const params = new URLSearchParams(qs)
  for (const [k, v] of params.entries()) out.set(k, v)
  return out
}

function buildDataCheckString(params: Map<string, string>): string {
  const entries: Array<[string, string]> = []
  for (const [k, v] of params.entries()) {
    if (k === "hash" || k === "signature") continue
    entries.push([k, v])
  }
  entries.sort((a, b) => a[0].localeCompare(b[0]))
  return entries.map(([k, v]) => `${k}=${v}`).join("\n")
}

export type VerifyResult =
  | { ok: true; userId: string; authDate: number }
  | { ok: false; reason: string }

export async function verifyTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSec: number,
): Promise<VerifyResult> {
  if (!initData) return { ok: false, reason: "missing_initdata" }
  if (!botToken) return { ok: false, reason: "missing_bot_token" }

  const params = parseQuery(initData)

  const hash = params.get("hash") ?? ""
  if (!hash) return { ok: false, reason: "missing_hash" }

  const authDateStr = params.get("auth_date") ?? ""
  const authDate = Number(authDateStr)
  if (!Number.isFinite(authDate) || authDate <= 0)
    return { ok: false, reason: "bad_auth_date" }

  if (maxAgeSec > 0) {
    const nowSec = Math.floor(Date.now() / 1000)
    if (nowSec - authDate > maxAgeSec) return { ok: false, reason: "expired" }
  }

  const userJson = params.get("user") ?? ""
  if (!userJson) return { ok: false, reason: "missing_user" }

  let userId = ""
  try {
    const u = JSON.parse(userJson) as { id?: number }
    userId = String(u?.id ?? "")
  } catch {
    return { ok: false, reason: "bad_user_json" }
  }
  if (!userId) return { ok: false, reason: "missing_user_id" }

  const dataCheckString = buildDataCheckString(params)

  // secret_key = HMAC_SHA256(bot_token, "WebAppData")
  // Telegram's pseudocode shows: HMAC_SHA256(<bot_token>, "WebAppData")
  // Meaning: key="WebAppData", data=bot_token.
  const secretKey = await hmacSha256(utf8("WebAppData"), utf8(botToken))

  // expected_hash = hex(HMAC_SHA256(data_check_string, secret_key))
  const expected = await hmacSha256(secretKey, utf8(dataCheckString))
  const expectedHex = toHex(expected)

  const a = utf8(expectedHex)
  const b = utf8(hash)

  if (!timingSafeEqual(a, b)) return { ok: false, reason: "invalid_signature" }

  return { ok: true, userId, authDate }
}
