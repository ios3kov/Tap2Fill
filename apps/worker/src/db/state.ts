import type { D1Database } from "@cloudflare/workers-types";

export type UserStateRow = {
  user_id: string;
  last_page_id: string | null;
  client_rev: number;
  updated_at: number; // unix seconds
};

function normalizeUserId(userId: string): string {
  const v = String(userId ?? "").trim();
  if (!v) throw new Error("USER_ID_REQUIRED");
  // Важно: у тебя в БД уже были "92286330.0". Это лечится нормализацией ДО записи.
  // Если ты гарантируешь digits-only — включай строгую проверку:
  // if (!/^\d+$/.test(v)) throw new Error("USER_ID_INVALID");
  return v;
}

function normalizeLastPageId(lastPageId: string | null): string | null {
  if (lastPageId === null) return null;
  const v = String(lastPageId).trim();
  if (!v) return null;
  if (v.length > 128) throw new Error("LAST_PAGE_ID_INVALID");
  return v;
}

function normalizeClientRev(clientRev: number): number {
  // Требуем конечное число
  if (typeof clientRev !== "number" || !Number.isFinite(clientRev)) {
    throw new Error("CLIENT_REV_INVALID");
  }
  // Требуем integer
  const v = Math.trunc(clientRev);
  if (v !== clientRev) throw new Error("CLIENT_REV_INVALID");
  if (v < 0) throw new Error("CLIENT_REV_INVALID");
  // защитная граница от переполнений/злоупотреблений
  if (v > 2_147_483_647) throw new Error("CLIENT_REV_INVALID");
  return v;
}

export async function getState(db: D1Database, userId: string): Promise<UserStateRow | null> {
  const uid = normalizeUserId(userId);

  const res = await db
    .prepare(
      `
      SELECT user_id, last_page_id, client_rev, updated_at
      FROM user_state
      WHERE user_id = ?
      LIMIT 1
    `,
    )
    .bind(uid)
    .first<UserStateRow>();

  return res ?? null;
}

/**
 * Idempotent state upsert:
 * - If incoming clientRev <= stored client_rev: no change (returns current row)
 * - If incoming clientRev > stored client_rev: update/insert
 *
 * One atomic SQL statement (no transactions needed).
 */
export async function upsertStateIdempotent(
  db: D1Database,
  userId: string,
  lastPageId: string | null,
  clientRev: number,
): Promise<UserStateRow> {
  const uid = normalizeUserId(userId);
  const lp = normalizeLastPageId(lastPageId);
  const rev = normalizeClientRev(clientRev);

  const now = Math.trunc(Date.now() / 1000);

  await db
    .prepare(
      `
      INSERT INTO user_state (user_id, last_page_id, client_rev, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        last_page_id = excluded.last_page_id,
        client_rev   = excluded.client_rev,
        updated_at   = excluded.updated_at
      WHERE excluded.client_rev > user_state.client_rev
    `,
    )
    .bind(uid, lp, rev, now)
    .run();

  const row = await getState(db, uid);
  if (!row) throw new Error("STATE_UPSERT_FAILED");
  return row;
}