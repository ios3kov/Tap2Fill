// apps/web/src/app/domain/snapshotBuilder.ts
import type { PageSnapshotV2 } from "../../local/snapshot"
import { clampNonNegativeInt, safeArrayOfStrings } from "./guards"

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
  return {
    schemaVersion: 2,
    pageId: params.pageId,
    contentHash: params.contentHash,
    clientRev: clampNonNegativeInt(params.clientRev, 0),
    demoCounter: clampNonNegativeInt(params.demoCounter, 0),
    paletteIdx: clampNonNegativeInt(params.paletteIdx, 0),

    progressB64: String(params.progressB64 ?? ""),
    regionsCount: clampNonNegativeInt(params.regionsCount, 0),
    paletteLen: clampNonNegativeInt(params.paletteLen, 0),

    undoStackB64: safeArrayOfStrings(params.undoStackB64, 64),
    undoBudgetUsed: clampNonNegativeInt(params.undoUsed, 0),

    updatedAtMs: Date.now(),
  }
}
