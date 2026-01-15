import { Hono } from "hono";
import type { Env, ParsedEnv } from "../env";
import { withParsedEnv } from "../env";
import { progressApi } from "./v1/progress";
import { stateApi } from "./v1/state";

export const api = new Hono<{ Bindings: ParsedEnv }>();

// Ensure numeric vars are parsed once.
api.use("*", async (c, next) => {
  // mutate env object with parsed numeric fields
  // (safe: only adds derived properties)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  c.env = withParsedEnv(c.env as unknown as Env) as any;
  await next();
});

api.get("/health", (c) => c.json({ ok: true }));

api.route("/", progressApi);
api.route("/", stateApi);
