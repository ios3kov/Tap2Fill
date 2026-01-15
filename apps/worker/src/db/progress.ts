// apps/worker/src/db/progress.ts
import type { D1Database } from "@cloudflare/workers-types";

export type ProgressRow = {
  user_id: string; // canonical digits-only string
  page_id: string;
  content_hash: string;
  client_rev: number;
  data_b64: string;
  time_spent_sec: number;
  updated_at: number;
};

export async function getProgress(db: D1Database, userId: string, pageId: string): Promise<ProgressRow | null> {
  const r = await db
    .prepare(
      `SELECT user_id, page_id, content_hash, client_rev, data_b64, time_spent_sec, updated_at
       FROM user_progress
       WHERE user_id = ?1 AND page_id = ?2
       LIMIT 1`,
    )
    .bind(userId, pageId)
    .first<ProgressRow>();

  return r ?? null;
}

export async function upsertProgressIdempotent(
  db: D1Database,
  row: Omit<ProgressRow, "updated_at">,
): Promise<ProgressRow> {
  await db
    .prepare(
      `INSERT INTO user_progress (user_id, page_id, content_hash, client_rev, data_b64, time_spent_sec, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, unixepoch())
       ON CONFLICT(user_id, page_id) DO UPDATE SET
         content_hash = excluded.content_hash,
         client_rev = excluded.client_rev,
         data_b64 = excluded.data_b64,
         time_spent_sec = excluded.time_spent_sec,
         updated_at = excluded.updated_at
       WHERE excluded.client_rev > user_progress.client_rev`,
    )
    .bind(row.user_id, row.page_id, row.content_hash, row.client_rev, row.data_b64, row.time_spent_sec)
    .run();

  const latest = await getProgress(db, row.user_id, row.page_id);
  if (!latest) {
    // deterministically return something even if read-after-write fails unexpectedly
    return { ...row, updated_at: Math.floor(Date.now() / 1000) };
  }
  return latest;
}