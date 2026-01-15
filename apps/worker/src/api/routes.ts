import { Hono } from "hono"
import type { Env } from "../env"

export const api = new Hono<{ Bindings: Env; Variables: { userId?: string } }>()

api.get("/health", (c) => c.json({ ok: true }))

api.get("/v1/pages", (c) => c.json({ items: [], nextCursor: null }))

api.get("/v1/me/state", async (c) => {
  const userId = c.get("userId") ?? ""
  if (!userId) return c.json({ error: "UNAUTHORIZED" }, 401)

  const db = c.env.DB
  if (!db) return c.json({ last_page_id: null })

  const row = await db
    .prepare("SELECT last_page_id FROM user_state WHERE user_id = ?")
    .bind(userId)
    .first<{ last_page_id: string | null }>()

  return c.json({ last_page_id: row?.last_page_id ?? null })
})

api.put("/v1/me/state", async (c) => {
  const userId = c.get("userId") ?? ""
  if (!userId) return c.json({ error: "UNAUTHORIZED" }, 401)

  const body = await c.req
    .json<{ last_page_id: string | null }>()
    .catch(() => null)
  if (!body) return c.json({ error: "BAD_JSON" }, 400)

  const db = c.env.DB
  if (!db) return c.json({ error: "DB_NOT_CONFIGURED" }, 503)

  const now = Date.now()
  await db
    .prepare(
      "INSERT INTO user_state(user_id, last_page_id, updated_at) VALUES(?, ?, ?) " +
        "ON CONFLICT(user_id) DO UPDATE SET last_page_id=excluded.last_page_id, updated_at=excluded.updated_at",
    )
    .bind(userId, body.last_page_id, now)
    .run()

  return c.json({ ok: true })
})
