import cors from "cors";
import express from "express";
import { Bot, InlineKeyboard } from "grammy";
import { getClub, getClubs } from "./clubs.js";
import { startReminderScheduler } from "./reminders.js";
import { addRegistration } from "./store.js";
import { getSubscription, getSubscriptions } from "./subscriptions.js";

const PORT = Number(process.env.PORT ?? 3000);
const BOT_TOKEN = process.env.BOT_TOKEN ?? "";
const WEBAPP_URL = process.env.WEBAPP_URL ?? "http://127.0.0.1:5173";
const ADMIN_IDS = (process.env.ADMIN_TELEGRAM_IDS ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/clubs", async (_req, res) => {
  try {
    res.json({ clubs: await getClubs() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "db_error" });
  }
});

app.get("/api/subscriptions", async (_req, res) => {
  try {
    res.json({ subscriptions: await getSubscriptions() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "db_error" });
  }
});

app.post("/api/registrations", async (req, res) => {
  const { clubId, telegramUserId } = req.body as { clubId?: string; telegramUserId?: string };
  const club = clubId ? await getClub(clubId) : null;
  if (!club) {
    res.status(404).json({ error: "club_not_found" });
    return;
  }
  if (club.taken >= club.seats) {
    res.status(409).json({ error: "full" });
    return;
  }

  // MVP: payment is simulated as instantly successful. Monobank invoice
  // creation + webhook confirmation will replace this later. clubs.taken is
  // kept accurate by a DB trigger on registrations insert.
  if (telegramUserId) {
    try {
      await addRegistration({ type: "club", clubId: club.id, telegramUserId });
    } catch (err) {
      console.error("failed to record registration", err);
    }
  }

  const message = `Нова оплачена заявка: ${club.title} (${club.date} ${club.startTime})`;
  if (bot && ADMIN_IDS.length) {
    await Promise.allSettled(ADMIN_IDS.map((id) => bot.api.sendMessage(id, message)));
  }

  res.json({ status: "paid" });
});

app.post("/api/subscriptions/purchase", async (req, res) => {
  const { subscriptionId, telegramUserId } = req.body as {
    subscriptionId?: string;
    telegramUserId?: string;
  };
  const subscription = subscriptionId ? await getSubscription(subscriptionId) : null;
  if (!subscription) {
    res.status(404).json({ error: "subscription_not_found" });
    return;
  }

  // MVP: payment is simulated as instantly successful, same as club registration.
  if (telegramUserId) {
    try {
      await addRegistration({ type: "subscription", subscriptionId: subscription.id, telegramUserId });
    } catch (err) {
      console.error("failed to record subscription purchase", err);
    }
  }

  const message = `Новий оплачений абонемент: ${subscription.title}`;
  if (bot && ADMIN_IDS.length) {
    await Promise.allSettled(ADMIN_IDS.map((id) => bot.api.sendMessage(id, message)));
  }

  res.json({ status: "paid" });
});

app.post("/api/payments/mono/webhook", (req, res) => {
  // Verify X-Sign, then mark registration paid and notify admin.
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
  startReminderScheduler(bot);
}
