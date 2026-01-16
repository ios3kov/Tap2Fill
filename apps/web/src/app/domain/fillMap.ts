// apps/web/src/app/domain/fillMap.ts
import type { FillMap } from "../coloring"
import { asRecord } from "./guards"

export function sanitizeFillMap(
  input: unknown,
  opts?: { maxEntries?: number },
): FillMap {
  const maxEntries = opts?.maxEntries ?? 20_000

  const rec = asRecord(input)
  if (!rec) return {}

  const out: FillMap = {}
  let n = 0

  for (const [k, v] of Object.entries(rec)) {
    if (n >= maxEntries) break
    if (typeof k !== "string" || k.length === 0 || k.length > 64) continue
    if (typeof v !== "string" || v.length === 0 || v.length > 64) continue
    if (!/^R\d{3}$/.test(k)) continue
    out[k] = v
    n++
  }

  return out
}
