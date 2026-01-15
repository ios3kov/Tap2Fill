import { Hono } from "hono";
import type { Env, ParsedEnv } from "../env";
import { withParsedEnv } from "../env";
import { progressApi } from "./v1/progress";
import { stateApi } from "./v1/state";

export const api = new Hono<{ Bindings: ParsedEnv }>();

// Parse numeric/env-derived fields once per request.
api.use("*", async (c, next) => {
  // Runtime env in Workers is stringly-typed; normalize/parse once here.
  // We intentionally replace c.env with the parsed view.
  c.env = withParsedEnv(c.env as unknown as Env) as unknown as ParsedEnv;
  await next();
});

api.get("/health", (c) => c.json({ ok: true }));

api.route("/", progressApi);
api.route("/", stateApi);