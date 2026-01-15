export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

export async function hmacSha256(
  key: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, data)
  return new Uint8Array(sig)
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => (b ?? 0).toString(16).padStart(2, "0")).join(
    "",
  )
}
