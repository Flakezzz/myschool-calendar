import type { Club } from "../data/clubs";
import type { Subscription } from "../data/subscriptions";
import { getTelegramInitData } from "./telegram";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "";
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/admin-write`;

async function call(action: "upsert" | "delete", table: "clubs" | "subscriptions", payload: unknown) {
  const res = await fetch(FUNCTION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initData: getTelegramInitData(), action, table, payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `request failed: ${res.status}`);
  return data;
}

function toClubRow(club: Club) {
  return {
    id: club.id,
    title: club.title,
    description: club.description,
    date: club.date,
    start_time: club.startTime,
    end_time: club.endTime,
    teacher: club.teacher,
    level: club.level,
    seats: club.seats,
    taken: club.taken,
    price_uah: club.priceUah,
    color: club.color,
  };
}

function toSubscriptionRow(sub: Subscription) {
  return {
    id: sub.id,
    title: sub.title,
    sessions: sub.sessions,
    description: sub.description,
    price_uah: sub.priceUah,
  };
}

export const saveClub = (club: Club) => call("upsert", "clubs", toClubRow(club));
export const deleteClub = (id: string) => call("delete", "clubs", { id });

export const saveSubscription = (sub: Subscription) => call("upsert", "subscriptions", toSubscriptionRow(sub));
export const deleteSubscription = (id: string) => call("delete", "subscriptions", { id });
