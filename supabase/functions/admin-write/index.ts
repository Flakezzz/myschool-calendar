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

type TelegramUser = { id: string; firstName: string; username: string };

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
// without this window a copy captured once (a screenshot, a log, a shared
// debugging session) would grant permanent write access on replay.
const MAX_INIT_DATA_AGE_SECONDS = 24 * 60 * 60;

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
  if (computedHash !== hash) return null;

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

/** Calls one of the SQL functions from supabase/bookings.sql, translating
 * its intentional exceptions into a code the UI can branch on. */
async function rpc(name: string, args: Record<string, unknown>): Promise<Response> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    const code = dbErrorCode(error.message ?? "");
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
      case "book_club":
        if (!body.clubId) return json({ error: "bad_payload" }, 400);
        return await rpc("book_club", {
          p_club_id: body.clubId,
          p_user_id: user.id,
          p_first_name: user.firstName,
          p_username: user.username,
        });

      case "buy_subscription":
        if (!body.subscriptionId) return json({ error: "bad_payload" }, 400);
        return await rpc("buy_subscription", {
          p_subscription_id: body.subscriptionId,
          p_user_id: user.id,
          p_first_name: user.firstName,
          p_username: user.username,
        });

      case "cancel_booking":
        if (!body.registrationId) return json({ error: "bad_payload" }, 400);
        return await rpc("cancel_booking", {
          p_registration_id: body.registrationId,
          p_user_id: user.id,
        });

      case "my_bookings": {
        // Scoped to the verified Telegram id, so one user can never see
        // another's bookings even though service_role bypasses RLS.
        const [bookings, passes] = await Promise.all([
          supabase
            .from("registrations")
            .select("id, created_at, paid_with, price_paid_uah, clubs(id, title, date, start_time, end_time, teacher, color)")
            .eq("telegram_user_id", user.id)
            .eq("type", "club")
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
    }

    // ---------------------------------------------------- admin-only below
    const adminIds = await getAdminIds();
    if (!adminIds.includes(user.id)) return json({ error: "forbidden" }, 403);

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
      const { error } = await supabase.from(table).upsert(body);
      if (error) throw error;
    } else if (action === "delete") {
      const { error } = await supabase.from(table).delete().eq("id", body.id);
      if (error) throw error;
    } else {
      return json({ error: "bad_action" }, 400);
    }

    return json({ ok: true });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
