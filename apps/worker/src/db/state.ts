export type StateRow = {
  user_id: number;
  last_page_id: string | null;
  updated_at: number;
};

export async function getState(db: D1Database, userId: number): Promise<StateRow | null> {
  const r = await db
    .prepare(`SELECT user_id, last_page_id, updated_at FROM user_state WHERE user_id = ?1`)
    .bind(userId)
    .first<StateRow>();
  return r ?? null;
}

export async function upsertState(db: D1Database, userId: number, lastPageId: string | null): Promise<StateRow> {
  await db
    .prepare(
      `INSERT INTO user_state (user_id, last_page_id, updated_at)
       VALUES (?1, ?2, unixepoch())
       ON CONFLICT(user_id) DO UPDATE SET
         last_page_id = excluded.last_page_id,
         updated_at = excluded.updated_at`,
    )
    .bind(userId, lastPageId)
    .run();

  const latest = await getState(db, userId);
  return latest ?? { user_id: userId, last_page_id: lastPageId, updated_at: Math.floor(Date.now() / 1000) };
}
