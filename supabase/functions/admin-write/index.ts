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
  // An invoice is still open for this club: a refusal the caller can act
  // on, not a server fault, so it must not be reported as one.
  "payment_pending",
  "club_full",
  "club_not_found",
  "club_already_started",
  "booking_not_found",
  "subscription_not_found",
  "already_has_pass",
  // A plan someone has bought cannot be deleted — it is what the receipts
  // point at. Hiding it is the way.
  "subscription_in_use",
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
  "sessions_count", "days_valid", "is_visible",
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
  /** Goes into the fiscal receipt as the product code. */
  code: string;
  title: string;
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
        destination: opts.title,
        // Required once fiscalisation is switched on, and harmless before.
        basketOrder: [
          {
            name: opts.title,
            qty: 1,
            sum: opts.amountKop,
            total: opts.amountKop,
            code: opts.code,
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

/** Refunds one invoice and says whether it was accepted, instead of
 * throwing. Cancelling a club refunds several people at once, and one
 * failure must not stop the rest from getting their money. */
async function tryRefund(invoiceId: string, amountKop: number | null): Promise<boolean> {
  try {
    await refundInvoice(invoiceId, amountKop);
    return true;
  } catch (err) {
    console.error("refund failed", invoiceId, describe(err));
    // Unclaim it so an admin (or the next attempt) can try again.
    await supabase.rpc("mark_refund_failed", { p_invoice_id: invoiceId });
    return false;
  }
}

/** Someone who closed the payment page and came back should land straight
 * on it again, not be told to wait out the fifteen-minute sweep. Returns
 * the page to resume, or null once the stale reservation has been cleared. */
async function resumablePayment(
  userId: string,
  what: { clubId?: string; subscriptionId?: string },
): Promise<{ invoiceId: string; pageUrl: string } | null> {
  const { data } = await supabase.rpc("find_pending_payment", {
    p_user_id: userId,
    p_club_id: what.clubId ?? null,
    p_subscription_id: what.subscriptionId ?? null,
  });
  if (!data?.invoice_id) return null;

  // Monobank is the authority on whether that invoice can still be paid.
  let status = "";
  try {
    const res = await fetch(
      `https://api.monobank.ua/api/merchant/invoice/status?invoiceId=${data.invoice_id}`,
      { headers: { "X-Token": MONO_TOKEN } },
    );
    if (res.ok) status = (await res.json()).status ?? "";
  } catch (err) {
    console.error("invoice status check failed", describe(err));
  }

  if ((status === "created" || status === "processing") && data.page_url) {
    return { invoiceId: data.invoice_id, pageUrl: data.page_url };
  }

  // Dead or unknown: drop it so a fresh attempt can start right away.
  await supabase.rpc("drop_pending_payment", { p_invoice_id: data.invoice_id });
  return null;
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

        const resume = await resumablePayment(user.id, { clubId: body.clubId });
        if (resume) {
          return json({
            ok: true,
            result: { needs_payment: true, paid_with: "card", resumed: true, ...resume },
          });
        }

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
            code: body.clubId,
            title: `Клаб «${reserved.club_title}»`,
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
          p_page_url: invoice.pageUrl,
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

      case "buy_subscription": {
        if (!body.subscriptionId) return json({ error: "bad_payload" }, 400);

        const resumeSub = await resumablePayment(user.id, { subscriptionId: body.subscriptionId });
        if (resumeSub) {
          return json({ ok: true, result: { needs_payment: true, resumed: true, ...resumeSub } });
        }

        const { data: reserved, error: reserveError } = await supabase.rpc("reserve_subscription", {
          p_subscription_id: body.subscriptionId,
          p_user_id: user.id,
          p_first_name: user.firstName,
          p_username: user.username,
        });
        if (reserveError) {
          const code = dbErrorCode(describe(reserveError));
          if (code) return json({ error: code }, 409);
          throw reserveError;
        }

        let invoice;
        try {
          invoice = await createInvoice({
            amountKop: reserved.amount_kop,
            reference: reserved.registration_id,
            code: body.subscriptionId,
            title: reserved.title,
          });
        } catch (err) {
          // Nothing was sold, so the pending purchase must not linger and
          // block the next attempt with "payment_pending".
          await supabase.from("registrations").delete().eq("id", reserved.registration_id);
          console.error("invoice create failed", describe(err));
          return json({ error: "payment_unavailable" }, 502);
        }

        await supabase.rpc("record_payment", {
          p_invoice_id: invoice.invoiceId,
          p_registration_id: reserved.registration_id,
          p_user_id: user.id,
          p_club_id: null,
          p_amount_kop: reserved.amount_kop,
          p_reference: reserved.registration_id,
          p_page_url: invoice.pageUrl,
        });

        return json({
          ok: true,
          result: { ...reserved, invoiceId: invoice.invoiceId, pageUrl: invoice.pageUrl },
        });
      }

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

      case "my_club_link": {
        if (!body.clubId) return json({ error: "bad_payload" }, 400);
        // The link is not in the public catalogue any more: the database
        // hands it over only to someone whose booking is paid for.
        const { data, error } = await supabase.rpc("club_link_for_user", {
          p_club_id: body.clubId,
          p_user_id: user.id,
        });
        if (error) throw error;
        return json({ ok: true, result: { meeting_url: data ?? null } });
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
        // payment_state matters here: a seat held for an unpaid invoice used
        // to appear in this list as a paying attendee, price and all.
        .select("id, created_at, telegram_user_id, telegram_first_name, telegram_username, paid_with, price_paid_uah, payment_state")
        .eq("club_id", body.clubId)
        .eq("type", "club")
        .order("created_at");
      if (error) throw error;
      return json({ ok: true, registrations: data });
    }

    if (action === "club_link") {
      if (!body.clubId) return json({ error: "bad_payload" }, 400);
      // The edit form needs the current value, or saving would wipe it.
      const { data, error } = await supabase
        .from("clubs")
        .select("meeting_url")
        .eq("id", body.clubId)
        .maybeSingle();
      if (error) throw error;
      return json({ ok: true, result: { meeting_url: data?.meeting_url ?? null } });
    }

    if (action === "reconcile_payments") {
      // Whatever this answers ends up in front of the school, not a
      // developer, so the statuses get read out in words.
      const asWords = (status: string): string =>
        ({
          created: "чекає оплату",
          processing: "обробляється",
          hold: "заморожено",
          success: "оплачено",
          failure: "не пройшла",
          reversed: "повернуто",
          expired: "прострочено",
        })[status] ?? status;

      // Nothing used to compare our records with Monobank's, so a payment
      // whose webhook never arrived stayed wrong forever. Asking Monobank
      // directly is the only way to find those.
      const { data: list, error } = await supabase.rpc("payments_to_reconcile", {
        p_limit: 50,
      });
      if (error) throw error;

      const changed: Record<string, string> = {};
      let checked = 0;
      for (const row of list ?? []) {
        checked++;
        let mono: {
          status?: string;
          amount?: number;
          cancelList?: { status?: string }[];
        } | null = null;
        try {
          const res = await fetch(
            `https://api.monobank.ua/api/merchant/invoice/status?invoiceId=${row.invoice_id}`,
            { headers: { "X-Token": MONO_TOKEN } },
          );
          if (res.ok) mono = await res.json();
        } catch (err) {
          console.error("reconcile status failed", row.invoice_id, describe(err));
        }
        const theirs = mono?.status;
        if (!theirs) continue;

        // A refund we promised but never sent. Cancelling claims the refund
        // on the row before calling Monobank, so if that call never
        // happened the row says "refunded" while the money is still ours.
        //
        // The invoice's own status is not enough to tell: a refund takes
        // days to settle, and until it does the invoice still reads
        // "success". Whether one is under way shows in cancelList instead.
        // Going by status alone would send a second refund to someone whose
        // first one was merely still travelling.
        const refundUnderWay = (mono?.cancelList ?? []).some(
          (c) => c.status === "processing" || c.status === "success",
        );
        if (row.refund_claimed && (theirs === "success" || theirs === "hold")) {
          if (refundUnderWay) {
            // Accepted by Monobank, just not settled. Nothing to do.
            continue;
          }
          if (await tryRefund(row.invoice_id, mono?.amount ?? null)) {
            changed[row.invoice_id] = "обіцяне повернення нарешті пішло";
          } else {
            changed[row.invoice_id] = "повернення так і не йде — поверни вручну";
          }
          continue;
        }

        // Money we are holding with nothing behind it, whose refund failed
        // at the time. Both sides say "success", so the status comparison
        // below would walk past it and it would sit there until a person
        // read the money-check and noticed.
        if (row.no_booking && !row.refund_claimed && (theirs === "success" || theirs === "hold")) {
          if (refundUnderWay) continue;
          changed[row.invoice_id] = (await tryRefund(row.invoice_id, mono?.amount ?? null))
            ? "гроші без запису — повернули"
            : "гроші без запису, повернути не вдалось — зроби вручну";
          continue;
        }

        if (theirs === row.our_status) continue;

        if (theirs === "reversed") {
          // Money went back and we never heard about it.
          await supabase.rpc("mark_refund_done", { p_invoice_id: row.invoice_id });
          changed[row.invoice_id] = `${asWords(row.our_status)} → повернуто`;
        } else {
          // Everything else goes through the same door as the webhook, so
          // the orphan and idempotency rules apply unchanged.
          try {
            const { data: applied } = await supabase.rpc("apply_payment_status", {
              p_invoice_id: row.invoice_id,
              p_status: theirs,
            });
            changed[row.invoice_id] = `${asWords(row.our_status)} → ${asWords(theirs)}`;
            // Money that arrived after we had given the seat away. The
            // webhook path refunds these; reconciliation has to as well, or
            // finding them would achieve nothing.
            if (applied?.orphan) {
              const ok = await tryRefund(row.invoice_id, mono?.amount ?? null);
              changed[row.invoice_id] = ok
                ? `${asWords(row.our_status)} → ${asWords(theirs)}, гроші повернули`
                : `${asWords(row.our_status)} → ${asWords(theirs)}, повернути не вдалось — зроби вручну`;
            }
          } catch (err) {
            console.error("reconcile apply failed", row.invoice_id, describe(err));
          }
        }
      }
      return json({ ok: true, result: { checked, changed } });
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

      if (table === "clubs") {
        // Deleting a club used to be pure profit: the bookings cascaded
        // away, the money stayed and nobody was told their class was off.
        // Refunds happen between the two halves of the cancellation.
        const { data: plan, error: planError } = await supabase.rpc(
          "prepare_club_cancellation",
          { p_club_id: body.id },
        );
        if (planError) {
          const code = dbErrorCode(describe(planError));
          if (code) return json({ error: code }, 409);
          throw planError;
        }

        let refunded = 0;
        let failed = 0;
        for (const r of plan?.refunds ?? []) {
          if (await tryRefund(r.invoice_id, r.amount_kop)) refunded++;
          else failed++;
        }

        const { data: outcome, error: finishError } = await supabase.rpc(
          "finish_club_cancellation",
          { p_club_id: body.id },
        );
        if (finishError) {
          const code = dbErrorCode(describe(finishError));
          if (code) return json({ error: code }, 409);
          throw finishError;
        }

        return json({
          ok: true,
          result: { ...outcome, refunded, refund_failed: failed },
        });
      }

      if (table === "subscriptions") {
        // The database refuses this once anyone has bought the plan, but a
        // raw foreign-key error means nothing to the person reading it.
        const { count, error: usedError } = await supabase
          .from("registrations")
          .select("id", { count: "exact", head: true })
          .eq("subscription_id", body.id);
        if (usedError) throw usedError;
        if ((count ?? 0) > 0) return json({ error: "subscription_in_use" }, 409);
      }

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
