// apps/web/src/app/domain/guards.ts
export type UnknownRecord = Record<string, unknown>

export function asRecord(v: unknown): UnknownRecord | null {
  return v && typeof v === "object" ? (v as UnknownRecord) : null
}

export function safeJson(x: unknown): string {
  try {
    return JSON.stringify(x)
  } catch {
    return String(x)
  }
}

export function isFiniteNonNegativeInt(v: unknown): v is number {
  return (
    typeof v === "number" && Number.isFinite(v) && v >= 0 && Number.isInteger(v)
  )
}

export function clampNonNegativeInt(v: unknown, fallback = 0): number {
  return isFiniteNonNegativeInt(v) ? v : fallback
}

export function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

export function safeArrayOfStrings(v: unknown, maxLen = 1000): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const x of v) {
    if (out.length >= maxLen) break
    if (typeof x === "string") {
      const s = x.trim()
      if (s) out.push(s)
    }
  }
  return out
}

/**
 * Normalizes and validates an external pageId (storage/server/catalog).
 * Return null if invalid.
 */
export function normalizePageId(pageId: unknown, maxLen = 64): string | null {
  const s = typeof pageId === "string" ? pageId.trim() : ""
  if (!s) return null
  if (s.length > maxLen) return null
  if (!/^[a-zA-Z0-9:_-]+$/.test(s)) return null
  return s
}
