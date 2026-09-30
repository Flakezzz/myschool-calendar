import cors from "cors";
import express from "express";
import { Bot, InlineKeyboard } from "grammy";

const PORT = Number(process.env.PORT ?? 3000);
const BOT_TOKEN = process.env.BOT_TOKEN ?? "";
const WEBAPP_URL = process.env.WEBAPP_URL ?? "http://127.0.0.1:5173";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/payments/mono/webhook", (req, res) => {
  // Verify X-Sign, then mark the registration paid. Not wired up yet —
  // Monobank integration is deferred; payment is simulated client-side
  // for now (see web/src/lib/supabase.ts).
  console.log("mono webhook", req.body);
  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`api on :${PORT}`);
});

const bot = BOT_TOKEN ? new Bot(BOT_TOKEN) : null;
if (bot) {
  bot.command("start", async (ctx) => {
    const keyboard = new InlineKeyboard().webApp("Відкрити календар", WEBAPP_URL);
    await ctx.reply("Календар клабів школи. Оберіть дату й зареєструйтесь.", {
      reply_markup: keyboard,
    });
  });
  bot.start();
}
