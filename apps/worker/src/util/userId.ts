// apps/worker/src/util/userId.ts
// Canonical Telegram user_id representation for storage and routing.
// We store it as a digits-only string to avoid "92286330.0" bugs and ensure cross-runtime stability.

export function normalizeUserId(input: unknown): string {
	const s = String(input ?? "").trim();
	const m = s.match(/^\d+/);
	return m?.[0] ?? "";
}

export function assertUserId(input: unknown): string {
	const id = normalizeUserId(input);
	if (!id) throw new Error("USER_ID_INVALID");
	return id;
}
