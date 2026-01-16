import { Hono } from "hono";
import type { ParsedEnv } from "../env";

const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

// Strict: only allow hash-based immutable object keys.
// Examples:
// - <64hex>.svg
// - <64hex>.webp
// - <64hex>.png
// - <64hex>.json
const KEY_RE = /^[a-f0-9]{64}\.(svg|webp|png|json)$/i;

function contentTypeForExt(ext: string): string {
	switch (ext.toLowerCase()) {
		case "svg":
			return "image/svg+xml; charset=utf-8";
		case "webp":
			return "image/webp";
		case "png":
			return "image/png";
		case "json":
			return "application/json; charset=utf-8";
		default:
			return "application/octet-stream";
	}
}

export const cdnApi = new Hono<{ Bindings: ParsedEnv }>();

cdnApi.get("/cdn/:key", async (c) => {
	const key = c.req.param("key");
	if (!KEY_RE.test(key)) return c.json({ ok: false, error: "NOT_FOUND" }, 404);

	const obj = await c.env.ASSETS.get(key);
	if (!obj) return c.json({ ok: false, error: "NOT_FOUND" }, 404);

	const ext = key.split(".").pop() ?? "";
	const headers = new Headers();

	// Prefer explicit content-type (avoid sniffing).
	headers.set("content-type", contentTypeForExt(ext));
	headers.set("x-content-type-options", "nosniff");

	// Immutable caching (key is content-hash).
	headers.set("cache-control", IMMUTABLE_CACHE);

	// ETag from R2
	headers.set("etag", obj.httpEtag);

	// Public read-only CDN usage. (Write never happens via this route.)
	headers.set("access-control-allow-origin", "*");
	headers.set("timing-allow-origin", "*");

	return new Response(obj.body, { status: 200, headers });
});
