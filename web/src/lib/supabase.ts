import { createClient } from "@supabase/supabase-js";
import type { Club } from "../data/clubs";
import type { Subscription } from "../data/subscriptions";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

// The anon key is meant to be public — it ships inside this bundle. Access
// control is enforced by Postgres Row Level Security policies, not secrecy
// of this key: it can only read the club/subscription catalogue. See
// supabase/schema.sql and supabase/lock-down-writes.sql.
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

// The admin list is NOT read from here. Asking the database for it with
// the public anon key published every admin's Telegram id to anyone who
// looked. The app now asks the Edge Function about the current user only
// (see fetchIsAdmin in lib/api.ts).

// Bookings and purchases are NOT written from here. They go through the
// admin-write Edge Function (see lib/api.ts), which verifies Telegram's
// signature first — the browser could otherwise claim any Telegram id.
