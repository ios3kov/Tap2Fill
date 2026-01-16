// apps/web/src/app/domain/snapshotBuilder.ts
import type { PageSnapshotV2 } from "../../local/snapshot"
import { clampNonNegativeInt, safeArrayOfStrings } from "./guards"
import {
  decodeBase64ToBytes,
  encodeBytesToBase64,
  makeEmptyProgressBytes,
} from "../progress/pack"

/**
 * Snapshot builder (Stage 3+)
 *
 * Responsibilities:
 * - Validate/normalize ids and numeric fields.
 * - Ensure packed progress invariants (shape + range).
 * - Produce a canonical snapshot payload for persistence.
 *
 * Invariants enforced here:
 * - pageId/contentHash are non-empty trimmed strings (bounded).
 * - progressB64 decodes to exactly regionsCount bytes.
 * - bytes are either UNPAINTED(255) or < paletteLen.
 *
 * If progress is invalid, we fall back to canonical empty packed progress
 * (all UNPAINTED) for the given regionsCount.
 *
 * DRY note:
 * - All byte/base64 logic is delegated to progress/pack.ts to avoid divergence.
 */

const MAX_ID_LEN = 256

function safeNonEmptyId(
  input: unknown,
  label: "pageId" | "contentHash",
): string {
  const s = typeof input === "string" ? input.trim() : ""
  if (!s) throw new Error(`${label.toUpperCase()}_EMPTY`)
  if (s.length > MAX_ID_LEN) throw new Error(`${label.toUpperCase()}_TOO_LONG`)
  return s
}

function makeEmptyProgressB64(regionsCount: number): string {
  return encodeBytesToBase64(makeEmptyProgressBytes(regionsCount))
}

function sanitizePackedProgress(params: {
  progressB64: unknown
  regionsCount: number
  paletteLen: number
}): string {
  const raw =
    typeof params.progressB64 === "string" ? params.progressB64.trim() : ""

  // Empty string is not a valid packed snapshot in Stage 3.
  if (!raw) return makeEmptyProgressB64(params.regionsCount)

  const res = decodeBase64ToBytes(raw, params.regionsCount, params.paletteLen)
  if (!res.ok) return makeEmptyProgressB64(params.regionsCount)

  // Canonicalize representation (trim -> decode -> encode)
  return encodeBytesToBase64(res.bytes)
}

export function buildSnapshot(params: {
  clientRev: number
  demoCounter: number
  pageId: string
  contentHash: string
  paletteIdx: number
  progressB64: string
  regionsCount: number
  paletteLen: number
  undoStackB64: string[]
  undoUsed: number
}): PageSnapshotV2 {
  const pageId = safeNonEmptyId(params.pageId, "pageId")
  const contentHash = safeNonEmptyId(params.contentHash, "contentHash")

  const regionsCount = clampNonNegativeInt(params.regionsCount, 0)
  const paletteLen = clampNonNegativeInt(params.paletteLen, 0)

  const progressB64 = sanitizePackedProgress({
    progressB64: params.progressB64,
    regionsCount,
    paletteLen,
  })

  return {
    schemaVersion: 2,
    pageId,
    contentHash,

    // Domain state
    clientRev: clampNonNegativeInt(params.clientRev, 0),
    paletteIdx: clampNonNegativeInt(params.paletteIdx, 0),

    // Analytics/debug (kept because PageSnapshotV2 requires it)
    demoCounter: clampNonNegativeInt(params.demoCounter, 0),

    // Packed progress (canonical + validated)
    progressB64,
    regionsCount,
    paletteLen,

    // Undo (deep validation is handled in snapshot storage layer)
    undoStackB64: safeArrayOfStrings(params.undoStackB64, 64),
    undoBudgetUsed: clampNonNegativeInt(params.undoUsed, 0),

    updatedAtMs: Date.now(),
  }
}
