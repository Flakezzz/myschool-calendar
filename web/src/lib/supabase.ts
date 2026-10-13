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
    // Never present in the public catalogue; filled in on demand for the
    // admin form and for attendees who paid.
    meetingUrl: row.meeting_url ?? null,
    videoUrl: row.video_url ?? null,
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

// Deliberately NOT "*": meeting_url is withheld from the public key, since
// anyone could read the bundle, take this key and pull every club's meeting
// link straight out of the API. Asking for it here would now fail outright.
// See supabase/money-fixes.sql, and fetchMyClubLink() for how an attendee
// gets the link.
const CLUB_PUBLIC_COLUMNS =
  "id,title,description,date,start_time,end_time,teacher,level,seats,taken,price_uah,color,video_url";

export async function fetchClubs(): Promise<Club[]> {
  const { data, error } = await supabase.from("clubs").select(CLUB_PUBLIC_COLUMNS).order("date");
  if (error) throw error;
  return data.map(fromClubRow);
}

export async function fetchSubscriptions(): Promise<Subscription[]> {
  // is_visible is the switch that takes a plan off the shelf without
  // deleting the row — purchase receipts point at it. Hidden plans are also
  // refused server-side, so this is the display half of one rule.
  const { data, error } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("is_visible", true)
    .order("price_uah");
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
