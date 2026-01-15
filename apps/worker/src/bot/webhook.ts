import type { Env } from "../env";
import { makeBot } from "./bot";

type JsonObject = Record<string, unknown>;

function safeJsonStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return "[unserializable]";
  }
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

    const update = (await req.json().catch((e) => {
      console.error("[bot] failed to parse json:", String(e));
      return null;
    })) as JsonObject | null;

    if (!update) return new Response("OK", { status: 200 });

    const bot = makeBot(env);

    await bot.handleUpdate(update).catch((e) => {
      console.error("[bot] handleUpdate error:", String(e));
      // Do not propagate to Telegram
    });

    return new Response("OK", { status: 200 });
  } catch (e) {
    console.error("[bot] webhook fatal:", String(e));
    return new Response("OK", { status: 200 });
  }
}
