export type Env = {
	// Secrets
	BOT_TOKEN: string;
	WEBHOOK_SECRET: string;

	// Vars
	ENV: string;
	WEBAPP_ORIGIN: string;

	INITDATA_MAX_AGE_SEC: string;
	PAYLOAD_MAX_BYTES: string;

	RATE_LIMIT_ENABLED: string;
	RATE_LIMIT_WINDOW_SEC: string;
	RATE_LIMIT_MAX_REQUESTS: string;

	// Bindings
	DB: D1Database;
	ASSETS: R2Bucket;
};

function toInt(v: string, dflt: number, min: number, max: number): number {
	const n = Number.parseInt(String(v ?? ""), 10);
	if (!Number.isFinite(n)) return dflt;
	return Math.max(min, Math.min(max, n));
}

export function withParsedEnv(e: Env) {
	return Object.assign(e, {
		INITDATA_MAX_AGE_SEC_NUM: toInt(e.INITDATA_MAX_AGE_SEC, 3600, 0, 86400),
		PAYLOAD_MAX_BYTES_NUM: toInt(
			e.PAYLOAD_MAX_BYTES,
			131072,
			1024,
			1024 * 1024,
		),
		RATE_LIMIT_ENABLED_BOOL: String(e.RATE_LIMIT_ENABLED) === "1",
		RATE_LIMIT_WINDOW_SEC_NUM: toInt(e.RATE_LIMIT_WINDOW_SEC, 60, 1, 3600),
		RATE_LIMIT_MAX_REQUESTS_NUM: toInt(
			e.RATE_LIMIT_MAX_REQUESTS,
			120,
			1,
			10000,
		),
	});
}

export type ParsedEnv = ReturnType<typeof withParsedEnv>;
