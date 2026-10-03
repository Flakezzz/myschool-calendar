// Every write in the app goes through one Supabase Edge Function, which
// verifies Telegram's signed initData before touching the database. The
// browser can't write directly: the anon key has no write policy on any
// table (see supabase/lock-down-writes.sql).
import type { Club } from "../data/clubs";
import type { Subscription } from "../data/subscriptions";
import { getTelegramInitData } from "./telegram";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/admin-write`;

/** Carries the short code the function returns ("already_booked",
 * "club_full", …) so callers can show a specific message. */
export class ApiError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

type Action =
  | "upsert"
  | "delete"
  | "club_registrations"
  | "book_club"
  | "buy_subscription"
  | "cancel_booking"
  | "my_bookings";

async function call(action: Action, payload: unknown, table?: "clubs" | "subscriptions"): Promise<any> {
  // Supabase's gateway requires a valid JWT in Authorization before a
  // request even reaches our function code — the anon key satisfies that.
  // The real identity check happens inside the function via initData.
  const res = await fetch(FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ initData: getTelegramInitData(), action, table, payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `request_failed_${res.status}`);
  return data;
}

// ------------------------------------------------------------- admin CRUD

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

export const saveClub = (club: Club) => call("upsert", toClubRow(club), "clubs");
export const deleteClub = (id: string) => call("delete", { id }, "clubs");

export const saveSubscription = (sub: Subscription) => call("upsert", toSubscriptionRow(sub), "subscriptions");
export const deleteSubscription = (id: string) => call("delete", { id }, "subscriptions");

// --------------------------------------------------------- admin: who booked

export type ClubRegistration = {
  id: string;
  createdAt: string;
  telegramUserId: string;
  name: string;
  username: string;
  paidWith: "cash" | "subscription";
  pricePaidUah: number | null;
};

export async function fetchClubRegistrations(clubId: string): Promise<ClubRegistration[]> {
  const data = await call("club_registrations", { clubId });
  return (data.registrations ?? []).map((r: any) => ({
    id: r.id,
    createdAt: r.created_at,
    telegramUserId: r.telegram_user_id,
    name: r.telegram_first_name ?? "",
    username: r.telegram_username ?? "",
    paidWith: r.paid_with,
    pricePaidUah: r.price_paid_uah,
  }));
}

// ------------------------------------------------------------- bookings

export type BookedClub = {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  teacher: string;
  color: string;
};

export type MyBooking = {
  id: string;
  paidWith: "cash" | "subscription";
  pricePaidUah: number | null;
  club: BookedClub | null;
};

export type MyPass = {
  id: string;
  title: string;
  sessionsTotal: number | null;
  sessionsUsed: number;
  expiresAt: string;
};

export type Mine = { bookings: MyBooking[]; passes: MyPass[] };

export async function fetchMine(): Promise<Mine> {
  const data = await call("my_bookings", {});
  return {
    bookings: (data.bookings ?? []).map((r: any) => ({
      id: r.id,
      paidWith: r.paid_with,
      pricePaidUah: r.price_paid_uah,
      club: r.clubs
        ? {
            id: r.clubs.id,
            title: r.clubs.title,
            date: r.clubs.date,
            startTime: String(r.clubs.start_time).slice(0, 5),
            endTime: String(r.clubs.end_time).slice(0, 5),
            teacher: r.clubs.teacher,
            color: r.clubs.color,
          }
        : null,
    })),
    passes: (data.passes ?? []).map((p: any) => ({
      id: p.id,
      title: p.title,
      sessionsTotal: p.sessions_total,
      sessionsUsed: p.sessions_used,
      expiresAt: p.expires_at,
    })),
  };
}

export type BookResult = {
  paidWith: "cash" | "subscription";
  pricePaidUah: number;
  sessionsLeft: number | null;
};

export async function bookClub(clubId: string): Promise<BookResult> {
  const data = await call("book_club", { clubId });
  return {
    paidWith: data.result?.paid_with ?? "cash",
    pricePaidUah: data.result?.price_paid_uah ?? 0,
    sessionsLeft: data.result?.sessions_left ?? null,
  };
}

export const cancelBooking = (registrationId: string) => call("cancel_booking", { registrationId });

export type BuyResult = { title: string; sessionsTotal: number | null; expiresAt: string };

export async function buySubscription(subscriptionId: string): Promise<BuyResult> {
  const data = await call("buy_subscription", { subscriptionId });
  return {
    title: data.result?.title ?? "",
    sessionsTotal: data.result?.sessions_total ?? null,
    expiresAt: data.result?.expires_at ?? "",
  };
}

/** The pass a booking would spend next, mirroring book_club()'s choice:
 * a limited pass before an unlimited one, soonest-expiring first. */
export function nextPass(passes: MyPass[]): MyPass | null {
  const usable = passes.filter((p) => p.sessionsTotal === null || p.sessionsUsed < p.sessionsTotal);
  if (!usable.length) return null;
  return [...usable].sort((a, b) => {
    const aUnlimited = a.sessionsTotal === null ? 1 : 0;
    const bUnlimited = b.sessionsTotal === null ? 1 : 0;
    if (aUnlimited !== bUnlimited) return aUnlimited - bUnlimited;
    return a.expiresAt.localeCompare(b.expiresAt);
  })[0];
}

export function passSessionsLeft(pass: MyPass): number | null {
  return pass.sessionsTotal === null ? null : pass.sessionsTotal - pass.sessionsUsed;
}
