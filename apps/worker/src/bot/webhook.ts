// apps/worker/src/bot/webhook.ts
import type { Env } from "../env";
import { makeBot } from "./bot";

type JsonObject = Record<string, unknown>;

function isObject(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null;
}

function hasUpdateId(v: JsonObject): v is JsonObject & { update_id: number } {
  return typeof v.update_id === "number";
}

export async function handleBotWebhook(req: Request, env: Env): Promise<Response> {
  // Telegram expects a fast 200. Never throw.
  try {
    if (!env.BOT_TOKEN) {
      console.error("[bot] BOT_TOKEN is missing in env");
      return new Response("OK", { status: 200 });
    }

    const ct = req.headers.get("content-type") ?? "";
    if (!ct.toLowerCase().includes("application/json")) {
      console.error("[bot] unexpected content-type:", ct);
      return new Response("OK", { status: 200 });
    }

    const parsed = await req.json().catch((e) => {
      console.error("[bot] failed to parse json:", String(e));
      return null;
    });

    if (!isObject(parsed)) return new Response("OK", { status: 200 });
    if (!hasUpdateId(parsed)) return new Response("OK", { status: 200 });

    const bot = makeBot(env);

    // Avoid `any`: bridge unknown into the handler's expected input type.
    type UpdateParam = Parameters<typeof bot.handleUpdate>[0];
    const update = parsed as unknown as UpdateParam;

    await bot.handleUpdate(update).catch((e: unknown) => {
      console.error("[bot] handleUpdate error:", String(e));
    });

    return new Response("OK", { status: 200 });
  } catch (e) {
    console.error("[bot] webhook fatal:", String(e));
    return new Response("OK", { status: 200 });
  }
}