import type { Bot } from "grammy";
import { clubs } from "./clubs.js";
import { getClubRegistrations, markReminderSent } from "./store.js";

const THRESHOLDS: { key: "day" | "h3" | "h1"; ms: number; label: string }[] = [
  { key: "day", ms: 24 * 60 * 60 * 1000, label: "за день" },
  { key: "h3", ms: 3 * 60 * 60 * 1000, label: "за 3 години" },
  { key: "h1", ms: 60 * 60 * 1000, label: "за годину" },
];

function clubStart(club: { date: string; startTime: string }): number {
  return new Date(`${club.date}T${club.startTime}:00`).getTime();
}

async function check(bot: Bot) {
  const now = Date.now();
  for (const reg of getClubRegistrations()) {
    const club = clubs.find((c) => c.id === reg.clubId);
    if (!club) continue;
    const msUntil = clubStart(club) - now;
    if (msUntil <= 0) continue;

    for (const t of THRESHOLDS) {
      if (!reg.reminders[t.key] && msUntil <= t.ms) {
        try {
          await bot.api.sendMessage(
            reg.telegramUserId,
            `⏰ Нагадування: клаб «${club.title}» починається ${t.label} (${club.date} о ${club.startTime}). Викладач: ${club.teacher}.`,
          );
        } catch (err) {
          console.error("reminder send failed", err);
        }
        markReminderSent(reg.id, t.key);
      }
    }
  }
}

export function startReminderScheduler(bot: Bot) {
  check(bot);
  setInterval(() => check(bot), 60_000);
}
