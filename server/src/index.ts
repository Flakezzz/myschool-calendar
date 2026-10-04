// Minimal Express app, kept only for the future Monobank payment webhook.
//
// The Telegram bot no longer lives here. /start used to be handled by a
// grammy long-polling loop in this process, which meant the bot only
// worked while this server was running. It now runs as a Supabase Edge
// Function webhook (supabase/functions/telegram-bot), online 24/7 with no
// server — so the bot was removed from here. Running long polling now
// would also 409-conflict with the registered webhook.
//
// Nothing in the app depends on this process today: the Mini App talks to
// Supabase directly, and reminders/notifications run in Postgres. This
// exists so the Monobank webhook has a home when that work starts; it can
// just as well become another Edge Function instead.

import cors from "cors";
import express from "express";

const PORT = Number(process.env.PORT ?? 3000);

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/payments/mono/webhook", (req, res) => {
  // Verify X-Sign, then mark the registration paid. Not wired up yet —
  // Monobank integration is deferred; payment is simulated for now.
  console.log("mono webhook", req.body);
  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`api on :${PORT}`);
});
