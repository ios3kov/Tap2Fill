// apps/worker/src/security/tgAuth.ts
import type { Context, Next } from "hono";
import type { Env } from "../env";
import { verifyTelegramInitData } from "./telegramInitData";

export type AuthContextVars = {
	tgUserId: string; // canonical digits-only user id
};

function getInitDataFromRequest(req: Request): string {
	const h = req.headers.get("x-tg-init-data") ?? "";
	if (h) return h;

	const url = new URL(req.url);
	return url.searchParams.get("initData") ?? "";
}

export function requireTelegramAuth() {
	return async (
		c: Context<{ Bindings: Env; Variables: AuthContextVars }>,
		next: Next,
	) => {
		const initData = getInitDataFromRequest(c.req.raw);
		const botToken = c.env.BOT_TOKEN ?? "";
		const maxAge = Math.max(
			0,
			Number(c.env.INITDATA_MAX_AGE_SEC ?? "3600") || 0,
		);

		const res = await verifyTelegramInitData(initData, botToken, maxAge);
		if (!res.ok) {
			return c.json(
				{ ok: false, error: "UNAUTHORIZED", reason: res.reason },
				401,
			);
		}

		c.set("tgUserId", res.userId);
		await next();
	};
}
