import { z } from "zod"

export const PageId = z.string().min(1).max(64)
export const ContentHash = z.string().min(8).max(128)

export const ProgressPayload = z.object({
  pageId: PageId,
  contentHash: ContentHash,
  clientRev: z.number().int().nonnegative(),
  dataB64: z.string().min(1).max(200000),
  timeSpentSec: z.number().int().nonnegative().optional(),
})

export type ProgressPayload = z.infer<typeof ProgressPayload>
