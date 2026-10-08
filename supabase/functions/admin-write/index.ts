// Supabase Edge Function: the only way anything gets written to this
// project's tables. Every request carries Telegram's signed initData, which
// this function verifies (HMAC against the bot token) before doing anything
// — so the user's identity is cryptographically proven, not just claimed by
// the browser. Writes then happen with the service_role key.
//
// Two groups of actions:
//   admin only  — upsert / delete clubs & subscriptions, club_registrations
//   any user    — book_club, cancel_booking, buy_subscription, my_bookings
//
// The anon key has no write policy on any table (see supabase/schema.sql
// and supabase/lock-down-writes.sql), so this function is the sole write
// path. It's named admin-write for historical reasons — renaming it would
// mean a new URL.
//
// Deploy via the Supabase Dashboard's Edge Functions editor (paste this
// file's contents, deploy) and set two function secrets there:
//   BOT_TOKEN            — same value as the project's .env BOT_TOKEN
//   ADMIN_TELEGRAM_IDS   — comma-separated, same as app_config's value
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically by
// Supabase into every Edge Function — no need to set those.

import { createClient } from "npm:@supabase/supabase-js@2";

const BOT_TOKEN = Deno.env.get("BOT_TOKEN") ?? "";
const FALLBACK_ADMIN_IDS = (Deno.env.get("ADMIN_TELEGRAM_IDS") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

type TelegramUser = { id: string; firstName: string; username: string; ageSeconds: number };

/** The admin list lives in app_config so it can be changed with one SQL
 * update rather than a redeploy. Falls back to the ADMIN_TELEGRAM_IDS
 * secret if that row can't be read. */
async function getAdminIds(): Promise<string[]> {
  try {
    const { data } = await supabase
      .from("app_config")
      .select("value")
      .eq("key", "admin_telegram_ids")
      .maybeSingle();
    const ids = (data?.value ?? "")
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);
    if (ids.length) return ids;
  } catch {
    // fall through to the secret
  }
  return FALLBACK_ADMIN_IDS;
}

async function hmacSha256(key: BufferSource, data: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// A signed initData string stays cryptographically valid forever, so
// without a window a copy captured once (a screenshot, a log, a shared
// debugging session) would grant permanent access on replay.
//
// Admin writes get a much shorter window than ordinary use: a leaked
// admin session can create and delete clubs, while a leaked ordinary one
// can only manage that person's own bookings.
const MAX_INIT_DATA_AGE_SECONDS = 24 * 60 * 60;
const MAX_ADMIN_INIT_DATA_AGE_SECONDS = 60 * 60;

/** Compares every character before returning, so how long this takes
 * doesn't reveal how much of the hash was correct. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
async function verifyInitData(initData: string): Promise<TelegramUser | null> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const dataCheckString = [...params.keys()]
    .sort()
    .map((k) => `${k}=${params.get(k)}`)
    .join("\n");

  const secretKey = await hmacSha256(new TextEncoder().encode("WebAppData"), BOT_TOKEN);
  const computedHash = toHex(await hmacSha256(secretKey, dataCheckString));
  if (!timingSafeEqual(computedHash, hash)) return null;

  const authDate = Number(params.get("auth_date"));
  if (!authDate) return null;
  const ageSeconds = Date.now() / 1000 - authDate;
  if (ageSeconds > MAX_INIT_DATA_AGE_SECONDS || ageSeconds < -300) return null;

  const userJson = params.get("user");
  if (!userJson) return null;
  const user = JSON.parse(userJson);
  if (!user?.id) return null;

  // Names come from the signed payload, never from the request body — this
  // is what makes the names in the admin's booking list trustworthy.
  const firstName = [user.first_name, user.last_name].filter(Boolean).join(" ");
  return {
    id: String(user.id),
    firstName: firstName || "",
    username: user.username ? String(user.username) : "",
    ageSeconds,
  };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Errors the database raises on purpose, which the UI turns into a specific
// message. Anything else is an unexpected failure and stays generic.
const KNOWN_DB_ERRORS = [
  "already_booked",
  "club_full",
  "club_not_found",
  "club_already_started",
  "booking_not_found",
  "subscription_not_found",
  "already_has_pass",
];

function dbErrorCode(message: string): string | null {
  return KNOWN_DB_ERRORS.find((code) => message.includes(code)) ?? null;
}

/** Supabase errors are plain objects, so String(err) on one gives the
 * useless "[object Object]". Dig out the message. */
function describe(err: unknown): string {
  if (typeof err === "object" && err !== null) {
    const e = err as { message?: unknown; details?: unknown };
    if (typeof e.message === "string") return e.message;
    if (typeof e.details === "string") return e.details;
    try {
      return JSON.stringify(err);
    } catch {
      // fall through
    }
  }
  return String(err);
}

const CLUB_COLUMNS = [
  "id", "title", "description", "date", "start_time", "end_time",
  "teacher", "level", "seats", "price_uah", "color",
  "meeting_url", "video_url",
];
const SUBSCRIPTION_COLUMNS = [
  "id", "title", "sessions", "description", "price_uah",
  "sessions_count", "days_valid",
];

function pick(row: Record<string, unknown>, allowed: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of allowed) if (key in row) out[key] = row[key];
  return out;
}

/** Calls one of the SQL functions from supabase/bookings.sql, translating
 * its intentional exceptions into a code the UI can branch on. */
const MONO_TOKEN = Deno.env.get("MONO_X_TOKEN") ?? "";
const MONO_WEBHOOK_URL = Deno.env.get("MONO_WEBHOOK_URL") ?? "";
const WEBAPP_URL = Deno.env.get("WEBAPP_URL") ?? "";

/** Creates a Monobank invoice that charges straight away — the client's
 * choice. The trade-off is that an early cancellation now needs a real
 * refund through the API rather than just dropping a hold. */
async function createInvoice(opts: {
  amountKop: number;
  reference: string;
  clubId: string;
  clubTitle: string;
}): Promise<{ invoiceId: string; pageUrl: string }> {
  const res = await fetch("https://api.monobank.ua/api/merchant/invoice/create", {
    method: "POST",
    headers: { "X-Token": MONO_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: opts.amountKop,
      ccy: 980,
      // The seat is released after 15 minutes, so the invoice must not
      // outlive it — otherwise someone pays for a seat already given away.
      validity: 900,
      paymentType: "debit",
      webHookUrl: MONO_WEBHOOK_URL || undefined,
      redirectUrl: WEBAPP_URL || undefined,
      merchantPaymInfo: {
        reference: opts.reference,
        destination: `Клаб «${opts.clubTitle}»`,
        // Required once fiscalisation is switched on, and harmless before.
        basketOrder: [
          {
            name: opts.clubTitle,
            qty: 1,
            sum: opts.amountKop,
            total: opts.amountKop,
            code: opts.clubId,
            unit: "шт.",
          },
        ],
      },
    }),
  });
  if (!res.ok) throw new Error(`mono ${res.status}: ${await res.text()}`);
  return await res.json();
}

/** Gives the money back. Monobank answers "processing" and settles it
 * asynchronously, so a 200 here means accepted, not yet landed. */
async function refundInvoice(invoiceId: string, amountKop: number | null) {
  const res = await fetch("https://api.monobank.ua/api/merchant/invoice/cancel", {
    method: "POST",
    headers: { "X-Token": MONO_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({
      invoiceId,
      ...(amountKop ? { amount: amountKop } : {}),
      extRef: invoiceId,
    }),
  });
  if (!res.ok) throw new Error(`mono refund ${res.status}: ${await res.text()}`);
  return await res.json();
}

async function rpc(name: string, args: Record<string, unknown>): Promise<Response> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    const code = dbErrorCode(describe(error));
    if (code) return json({ error: code }, 409);
    throw error;
  }
  return json({ ok: true, result: data });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { initData, action, table, payload } = await req.json();

    const user = await verifyInitData(initData ?? "");
    if (!user) return json({ error: "unauthorized" }, 401);

    const body = payload ?? {};

    // ------------------------------------------------ actions for any user
    switch (action) {
      case "book_club": {
        if (!body.clubId) return json({ error: "bad_payload" }, 400);

        // Holds the seat. A usable pass makes the booking real immediately;
        // otherwise the seat is pending until the money is held.
        const { data: reserved, error: reserveError } = await supabase.rpc("reserve_club", {
          p_club_id: body.clubId,
          p_user_id: user.id,
          p_first_name: user.firstName,
          p_username: user.username,
        });
        if (reserveError) {
          const code = dbErrorCode(describe(reserveError));
          if (code) return json({ error: code }, 409);
          throw reserveError;
        }
        if (!reserved.needs_payment) return json({ ok: true, result: reserved });

        // The amount comes from the database, never from the caller.
        let invoice;
        try {
          invoice = await createInvoice({
            amountKop: reserved.amount_kop,
            reference: reserved.registration_id,
            clubId: body.clubId,
            clubTitle: reserved.club_title,
          });
        } catch (err) {
          // No invoice means no way to pay, so the seat must not stay held.
          await supabase.from("registrations").delete().eq("id", reserved.registration_id);
          console.error("invoice create failed", describe(err));
          return json({ error: "payment_unavailable" }, 502);
        }

        await supabase.rpc("record_payment", {
          p_invoice_id: invoice.invoiceId,
          p_registration_id: reserved.registration_id,
          p_user_id: user.id,
          p_club_id: body.clubId,
          p_amount_kop: reserved.amount_kop,
          p_reference: reserved.registration_id,
        });

        return json({ ok: true, result: { ...reserved, invoiceId: invoice.invoiceId, pageUrl: invoice.pageUrl } });
      }

      case "payment_status": {
        if (!body.invoiceId) return json({ error: "bad_payload" }, 400);
        // Scoped to the caller, so nobody can read someone else's payment.
        const { data, error } = await supabase
          .from("payments")
          .select("invoice_id, status, registration_id")
          .eq("invoice_id", body.invoiceId)
          .eq("telegram_user_id", user.id)
          .maybeSingle();
        if (error) throw error;
        if (!data) return json({ error: "payment_not_found" }, 404);
        return json({ ok: true, result: data });
      }

      case "buy_subscription":
        if (!body.subscriptionId) return json({ error: "bad_payload" }, 400);
        return await rpc("buy_subscription", {
          p_subscription_id: body.subscriptionId,
          p_user_id: user.id,
          p_first_name: user.firstName,
          p_username: user.username,
        });

      case "cancel_booking": {
        if (!body.registrationId) return json({ error: "bad_payload" }, 400);
        const { data, error } = await supabase.rpc("cancel_booking", {
          p_registration_id: body.registrationId,
          p_user_id: user.id,
        });
        if (error) {
          const code = dbErrorCode(describe(error));
          if (code) return json({ error: code }, 409);
          throw error;
        }

        // The seat is already free; the money is a separate promise. If the
        // refund call fails the claim is released so it can be retried,
        // and the person is told rather than left guessing.
        let refunded: boolean | null = null;
        if (data?.refund_invoice_id) {
          try {
            await refundInvoice(data.refund_invoice_id, data.refund_amount_kop);
            refunded = true;
          } catch (err) {
            console.error("refund failed", data.refund_invoice_id, describe(err));
            await supabase.rpc("mark_refund_failed", { p_invoice_id: data.refund_invoice_id });
            refunded = false;
          }
        }

        return json({ ok: true, result: { ...data, refunded } });
      }

      case "my_bookings": {
        // Scoped to the verified Telegram id, so one user can never see
        // another's bookings even though service_role bypasses RLS.
        const [bookings, passes] = await Promise.all([
          supabase
            .from("registrations")
            .select("id, created_at, paid_with, price_paid_uah, clubs(id, title, date, start_time, end_time, teacher, color)")
            .eq("telegram_user_id", user.id)
            .eq("type", "club")
            // A seat held for an unpaid invoice is not a booking yet, and
            // showing it would promise something that may vanish in 15 min.
            .eq("payment_state", "confirmed")
            .order("created_at", { ascending: false }),
          supabase
            .from("user_subscriptions")
            .select("id, title, sessions_total, sessions_used, expires_at")
            .eq("telegram_user_id", user.id)
            .gt("expires_at", new Date().toISOString())
            .order("expires_at"),
        ]);
        if (bookings.error) throw bookings.error;
        if (passes.error) throw passes.error;
        return json({ ok: true, bookings: bookings.data, passes: passes.data });
      }

      case "am_i_admin": {
        // Answers only about the caller. The app used to read the whole
        // admin list from app_config with the public key, which published
        // both admins' Telegram ids to anyone who looked.
        const ids = await getAdminIds();
        return json({ ok: true, isAdmin: ids.includes(user.id) });
      }
    }

    // ---------------------------------------------------- admin-only below
    const adminIds = await getAdminIds();
    if (!adminIds.includes(user.id)) return json({ error: "forbidden" }, 403);

    // A leaked admin session is worth far more than an ordinary one, so it
    // expires sooner. Reopening the app refreshes it, so this is invisible
    // in normal use.
    if (user.ageSeconds > MAX_ADMIN_INIT_DATA_AGE_SECONDS) {
      return json({ error: "admin_session_expired" }, 401);
    }

    if (action === "club_registrations") {
      if (!body.clubId) return json({ error: "bad_payload" }, 400);
      const { data, error } = await supabase
        .from("registrations")
        .select("id, created_at, telegram_user_id, telegram_first_name, telegram_username, paid_with, price_paid_uah")
        .eq("club_id", body.clubId)
        .eq("type", "club")
        .order("created_at");
      if (error) throw error;
      return json({ ok: true, registrations: data });
    }

    if (table !== "clubs" && table !== "subscriptions") {
      return json({ error: "bad_table" }, 400);
    }

    if (action === "upsert") {
      // Whatever JSON arrived used to be written straight through, so an
      // admin could set any column — including clubs.taken, desyncing the
      // seat counter from the real bookings. `taken` is deliberately NOT
      // writable: the database owns it (see the triggers in bookings.sql),
      // and leaving it out of the payload keeps it untouched on update and
      // at its default of 0 on insert.
      const row = pick(body, table === "clubs" ? CLUB_COLUMNS : SUBSCRIPTION_COLUMNS);
      if (!row.id) return json({ error: "bad_payload" }, 400);
      const { error } = await supabase.from(table).upsert(row);
      if (error) throw error;
    } else if (action === "delete") {
      // Without this, a payload missing `id` filtered on the string
      // "undefined": it matched nothing, so nothing was lost, but the
      // function still answered {ok:true} and the UI would report a
      // successful delete that never happened.
      if (!body.id) return json({ error: "bad_payload" }, 400);
      const { error } = await supabase.from(table).delete().eq("id", body.id);
      if (error) throw error;
    } else {
      return json({ error: "bad_action" }, 400);
    }

    return json({ ok: true });
  } catch (err) {
    return json({ error: describe(err) }, 500);
  }
});
