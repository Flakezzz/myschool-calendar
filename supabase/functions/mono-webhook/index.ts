// Monobank payment webhook.
//
// Monobank POSTs here whenever an invoice changes state, signing the body
// with its private key. Anyone can reach this URL, so the signature is the
// only thing standing between us and a forged "paid" — it is verified
// before the body is even parsed, and nothing else is trusted.
//
// Deploy with Verify JWT OFF: Monobank cannot send a Supabase JWT.
// Function secrets required:
//   MONO_X_TOKEN — the merchant token, used only to fetch the public key
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by Supabase.

import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const MONO_TOKEN = Deno.env.get("MONO_X_TOKEN") ?? "";

/** Money that arrived for a seat nobody holds any more — released by the
 * sweep, or cancelled a moment earlier. Keeping it would mean charging for
 * nothing, so it goes straight back. */
async function refund(invoiceId: string) {
  const res = await fetch("https://api.monobank.ua/api/merchant/invoice/cancel", {
    method: "POST",
    headers: { "X-Token": MONO_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ invoiceId, extRef: `orphan-${invoiceId}` }),
  });
  if (!res.ok) throw new Error(`refund ${res.status}: ${await res.text()}`);
}

/** Monobank asks that the key be cached and refetched only when a
 * verification starts failing, not on every webhook. */
let cachedKey: CryptoKey | null = null;

async function fetchPublicKey(): Promise<CryptoKey> {
  const res = await fetch("https://api.monobank.ua/api/merchant/pubkey", {
    headers: { "X-Token": MONO_TOKEN },
  });
  if (!res.ok) throw new Error(`pubkey ${res.status}`);
  const { key } = await res.json();

  // The field is base64 of a PEM document, so it unwraps twice.
  const pem = atob(key);
  const der = base64ToBytes(
    pem.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, "").replace(/\s+/g, ""),
  );
  return await crypto.subtle.importKey(
    "spki",
    der,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Monobank signs in ASN.1 DER (SEQUENCE of two INTEGERs); Web Crypto wants
 * the raw r‖s pair, each padded to 32 bytes. Without this conversion every
 * signature looks invalid. */
function derToP1363(der: Uint8Array): Uint8Array | null {
  if (der[0] !== 0x30) return null;
  let i = 2;
  if (der[1] & 0x80) i = 2 + (der[1] & 0x7f); // long-form length
  const readInt = (): Uint8Array | null => {
    if (der[i] !== 0x02) return null;
    const len = der[i + 1];
    let start = i + 2;
    let end = start + len;
    while (der[start] === 0x00 && end - start > 32) start++; // drop sign padding
    i = end;
    return der.slice(start, end);
  };
  const r = readInt();
  const s = readInt();
  if (!r || !s || r.length > 32 || s.length > 32) return null;
  const out = new Uint8Array(64);
  out.set(r, 32 - r.length);
  out.set(s, 64 - s.length);
  return out;
}

async function verify(body: Uint8Array, signB64: string): Promise<boolean> {
  const sig = derToP1363(base64ToBytes(signB64));
  if (!sig) return false;
  const check = async () => {
    if (!cachedKey) cachedKey = await fetchPublicKey();
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      cachedKey,
      sig,
      body,
    );
  };
  if (await check()) return true;
  // A rotated key looks exactly like a bad signature — try once with a fresh one.
  cachedKey = null;
  return await check();
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  try {
    const raw = new Uint8Array(await req.arrayBuffer());
    const sign = req.headers.get("X-Sign") ?? "";
    if (!sign || !(await verify(raw, sign))) {
      console.error("rejected: bad signature");
      return new Response("bad signature", { status: 400 });
    }

    const payload = JSON.parse(new TextDecoder().decode(raw));
    const invoiceId = payload?.invoiceId;
    const status = payload?.status;
    if (!invoiceId || !status) return new Response("bad payload", { status: 400 });

    const { data, error } = await supabase.rpc("apply_payment_status", {
      p_invoice_id: invoiceId,
      p_status: status,
    });
    if (error) {
      // An unknown invoice is not worth retrying for; anything else is.
      if (String(error.message ?? error).includes("payment_not_found")) {
        console.error("unknown invoice", invoiceId);
        return new Response("ok", { status: 200 });
      }
      throw error;
    }

    if (data?.orphan) {
      // The database has already marked it refunded so it cannot be claimed
      // twice; if the call fails, admins were warned in the same breath.
      try {
        await refund(invoiceId);
        console.log("orphan refunded", invoiceId);
      } catch (err) {
        console.error("orphan refund failed", invoiceId, String(err));
      }
    }

    console.log("applied", JSON.stringify(data));
    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("webhook failed", String(err));
    // Non-200 makes Monobank retry, which is what we want for a transient fault.
    return new Response("error", { status: 500 });
  }
});
