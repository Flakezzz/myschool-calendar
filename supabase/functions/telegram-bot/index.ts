// Supabase Edge Function: the Telegram bot's webhook.
//
// Replaces the old long-polling server (server/src/index.ts), which only
// answered /start while a laptop was running. Telegram now POSTs every
// update here instead, so the bot is online 24/7 with no server process
// and no monthly cost — the same serverless approach as the rest of this
// project.
//
// All it does today is answer /start with a button that opens the Mini
// App. Everything else (reminders, admin notifications) already runs in
// Postgres via pg_cron.
//
// DEPLOY (Supabase Dashboard -> Edge Functions):
//   1. New function named exactly "telegram-bot", paste this file, deploy.
//   2. Turn OFF "Verify JWT" for this function — Telegram can't send a
//      Supabase JWT, so the gateway must let its POSTs through. The secret
//      token below is what actually authenticates Telegram instead.
//   3. Function secrets needed (Settings -> Edge Functions -> Secrets):
//        BOT_TOKEN                 — already set (admin-write uses it)
//        TELEGRAM_WEBHOOK_SECRET   — the random value from setup
//        WEBAPP_URL                — optional; defaults below
//   4. Register the webhook with Telegram (done once, from setup).

const BOT_TOKEN = Deno.env.get("BOT_TOKEN") ?? "";
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
const WEBAPP_URL = Deno.env.get("WEBAPP_URL") ?? "https://flakezzz.github.io/myschool-calendar/";

const WELCOME =
  "Вітаємо у MySchool! 👋\n\n" +
  "Тут календар наших клабів: обирайте дату, дивіться деталі та записуйтесь. " +
  "Натисніть кнопку нижче, щоб відкрити.";

async function telegram(method: string, body: unknown): Promise<void> {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.serve(async (req) => {
  // Telegram echoes back the secret we registered with setWebhook. Anyone
  // else hitting this public URL lacks it, so they get nothing. Fail closed
  // if the secret wasn't configured, rather than accepting every request.
  const token = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!WEBHOOK_SECRET || token !== WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }

  let update: any;
  try {
    update = await req.json();
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const message = update.message ?? update.edited_message;
  const text: string = message?.text ?? "";

  // Reply to /start (with or without a deep-link payload: "/start", "/start foo").
  if (message && /^\/start(\s|$|@)/.test(text)) {
    await telegram("sendMessage", {
      chat_id: message.chat.id,
      text: WELCOME,
      reply_markup: {
        inline_keyboard: [[{ text: "📅 Відкрити календар", web_app: { url: WEBAPP_URL } }]],
      },
    });
  }

  // Always 200 quickly so Telegram doesn't retry. Unknown updates are
  // simply ignored.
  return new Response("ok");
});
