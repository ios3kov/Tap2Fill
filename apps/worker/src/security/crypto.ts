// apps/worker/src/security/crypto.ts
const te = new TextEncoder();

/**
 * Convert ArrayBuffer to lowercase hex string.
 * Safe under `noUncheckedIndexedAccess`.
 */
export function toHex(bytes: ArrayBuffer): string {
  const u8 = new Uint8Array(bytes);
  let out = "";
  for (let i = 0; i < u8.length; i++) {
    const b = u8[i];
    if (b === undefined) continue;
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Convert Uint8Array view into a standalone ArrayBuffer (copy).
 * Guarantees ArrayBuffer type (avoids ArrayBuffer|SharedArrayBuffer unions).
 */
export function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
}

/**
 * HMAC_SHA256(keyBytes, msg) -> ArrayBuffer signature.
 * Type-safe for CF Workers + strict TS.
 */
export async function hmacSha256(keyBytes: Uint8Array, msg: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(keyBytes),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const data = te.encode(msg);
  return crypto.subtle.sign("HMAC", cryptoKey, toArrayBuffer(data));
}