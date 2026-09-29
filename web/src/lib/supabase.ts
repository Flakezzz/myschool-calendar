import { createClient } from "@supabase/supabase-js";
import type { Club } from "../data/clubs";
import type { Subscription } from "../data/subscriptions";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

// The anon key is meant to be public — it ships inside this bundle. Access
// control is enforced by Postgres Row Level Security policies, not secrecy
// of this key. See supabase/schema.sql.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function fromClubRow(row: any): Club {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    date: row.date,
    startTime: row.start_time.slice(0, 5),
    endTime: row.end_time.slice(0, 5),
    teacher: row.teacher,
    level: row.level,
    seats: row.seats,
    taken: row.taken,
    priceUah: row.price_uah,
    color: row.color,
  };
}

function fromSubscriptionRow(row: any): Subscription {
  return {
    id: row.id,
    title: row.title,
    sessions: row.sessions,
    description: row.description,
    priceUah: row.price_uah,
  };
}

export async function fetchClubs(): Promise<Club[]> {
  const { data, error } = await supabase.from("clubs").select("*").order("date");
  if (error) throw error;
  return data.map(fromClubRow);
}

export async function fetchSubscriptions(): Promise<Subscription[]> {
  const { data, error } = await supabase.from("subscriptions").select("*").order("price_uah");
  if (error) throw error;
  return data.map(fromSubscriptionRow);
}

export async function registerForClub(clubId: string, telegramUserId: string) {
  const { error } = await supabase
    .from("registrations")
    .insert({ type: "club", club_id: clubId, telegram_user_id: telegramUserId });
  if (error) throw error;
}

export async function purchaseSubscription(subscriptionId: string, telegramUserId: string) {
  const { error } = await supabase
    .from("registrations")
    .insert({ type: "subscription", subscription_id: subscriptionId, telegram_user_id: telegramUserId });
  if (error) throw error;
}
