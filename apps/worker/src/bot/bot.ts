import { Bot, InlineKeyboard } from "grammy"
import type { Env } from "../env"

export function makeBot(env: Env): Bot {
  const token = env.BOT_TOKEN ?? ""
  if (!token) throw new Error("BOT_TOKEN is not set")

  const bot = new Bot(token)

  bot.command("start", async (ctx) => {
    const webAppUrl = env.WEBAPP_ORIGIN
    const kb = new InlineKeyboard().webApp("🎨 Open Coloring", webAppUrl)
    await ctx.reply("Tap2Fill — cozy coloring in short sessions.", {
      reply_markup: kb,
    })
  })

  return bot
}
