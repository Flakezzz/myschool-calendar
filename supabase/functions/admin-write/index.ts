// Supabase Edge Function: the only way club/subscription data can be
// written. Validates Telegram's signed initData (so we know which real
// Telegram user is calling, not just what the client claims) and checks
// that user against the admin list before writing with the service_role
// key. The browser's anon key has no write policy on these tables at all
// (see supabase/schema.sql) — this function is the sole write path.
//
// Deploy via the Supabase Dashboard's Edge Functions editor (paste this
// file's contents, deploy) and set two function secrets there:
//   BOT_TOKEN            — same value as the project's .env BOT_TOKEN
//   ADMIN_TELEGRAM_IDS    — comma-separated, same as app_config's value
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
// debugging session) would grant permanent admin write access on replay.
const MAX_INIT_DATA_AGE_SECONDS = 24 * 60 * 60;

// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
async function verifyInitData(initData: string): Promise<{ id: string } | null> {
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
  return { id: String(user.id) };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { initData, action, table, payload } = await req.json();

    const user = await verifyInitData(initData ?? "");
    const adminIds = await getAdminIds();
    if (!user || !adminIds.includes(user.id)) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (table !== "clubs" && table !== "subscriptions") {
      return new Response(JSON.stringify({ error: "bad_table" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "upsert") {
      const { error } = await supabase.from(table).upsert(payload);
      if (error) throw error;
    } else if (action === "delete") {
      const { error } = await supabase.from(table).delete().eq("id", payload.id);
      if (error) throw error;
    } else {
      return new Response(JSON.stringify({ error: "bad_action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
