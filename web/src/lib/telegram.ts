const BG_BY_THEME = { light: "#f4efe6", dark: "#14181f" } as const;

export function initTelegram() {
  const tg = window.Telegram?.WebApp;
  if (!tg) return;
  tg.ready();
  tg.expand();
  // Without this, dragging our own sheets upward also drags the Telegram
  // window and can close the app. Added in Bot API 7.7 — older clients simply
  // do not expose it, and the sheet still works, just with that conflict.
  tg.disableVerticalSwipes?.();
}

export function syncTelegramTheme(mode: "light" | "dark") {
  const tg = window.Telegram?.WebApp;
  if (!tg) return;
  const color = BG_BY_THEME[mode];
  tg.setHeaderColor(color);
  tg.setBackgroundColor(color);
}

// Paying means leaving the Mini App for Monobank's page and coming back.
// Telegram injects initData only on first launch, so after that round trip
// window.Telegram.WebApp.initData is empty and the app would look like it
// was opened outside Telegram. The signed session is therefore kept in
// storage for the length of the trip. It stays valid for 24 hours, which the
// Edge Function enforces, so a few minutes away is well inside the window.
const SESSION_KEY = "ms_tg_session";
const PENDING_KEY = "ms_pending_payment";

type StoredSession = { initData: string; userId: string };

/** sessionStorage goes with the webview; localStorage is the belt to its
 * braces in case a webview treats the return trip as a fresh context. */
function stores(): Storage[] {
  const out: Storage[] = [];
  try {
    out.push(window.sessionStorage);
  } catch {
    /* blocked */
  }
  try {
    out.push(window.localStorage);
  } catch {
    /* blocked */
  }
  return out;
}

function readJson<T>(key: string): T | null {
  for (const store of stores()) {
    try {
      const raw = store.getItem(key);
      if (raw) return JSON.parse(raw) as T;
    } catch {
      /* unreadable or not ours */
    }
  }
  return null;
}

function writeJson(key: string, value: unknown) {
  const raw = JSON.stringify(value);
  for (const store of stores()) {
    try {
      store.setItem(key, raw);
    } catch {
      /* out of space or blocked */
    }
  }
}

function forget(key: string) {
  for (const store of stores()) {
    try {
      store.removeItem(key);
    } catch {
      /* nothing to do */
    }
  }
}

let restored: StoredSession | null | undefined;

function storedSession(): StoredSession | null {
  if (restored === undefined) restored = readJson<StoredSession>(SESSION_KEY);
  return restored;
}

export function getTelegramUserId(): string | null {
  const id = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
  if (id) return String(id);
  return storedSession()?.userId ?? null;
}

export function getTelegramInitData(): string {
  const live = window.Telegram?.WebApp?.initData ?? "";
  if (live) return live;
  return storedSession()?.initData ?? "";
}

export type PendingPayment = {
  invoiceId: string;
  clubTitle: string;
  subtitle: string;
  priceUah: number;
};

/** Read once and dropped: whatever happens next, the app must not keep
 * asking about a payment it has already reported. */
export function takePendingPayment(): PendingPayment | null {
  const pending = readJson<PendingPayment>(PENDING_KEY);
  if (pending) forget(PENDING_KEY);
  return pending;
}

/** Sends the person to Monobank inside Telegram rather than handing them to
 * an external browser, which would also bring them back to the browser and
 * not to the chat. */
export function openPaymentPage(url: string, pending: PendingPayment) {
  const initData = window.Telegram?.WebApp?.initData ?? "";
  const userId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
  if (initData && userId) writeJson(SESSION_KEY, { initData, userId: String(userId) });
  writeJson(PENDING_KEY, pending);
  window.location.assign(url);
}

/** Fallback only, used if the server-side admin check can't be reached.
 * The real list lives in the database and is never sent to the browser —
 * the Edge Function answers "are YOU an admin?" and nothing more. This
 * only decides whether the admin button is drawn; every admin write is
 * verified server-side regardless. */
const FALLBACK_ADMIN_IDS = (import.meta.env.VITE_ADMIN_TELEGRAM_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export function isFallbackAdmin(): boolean {
  const id = getTelegramUserId();
  return !!id && FALLBACK_ADMIN_IDS.includes(id);
}

/** Public, so it is safe in the bundle. Overridable per build. */
const BOT_USERNAME = import.meta.env.VITE_BOT_USERNAME ?? "englishschoolcalendar_bot";

/** Deep link that reopens the Mini App on one specific club. */
export function clubShareLink(clubId: string): string {
  return `https://t.me/${BOT_USERNAME}?startapp=${encodeURIComponent(clubId)}`;
}

/** Inside Telegram this opens the native "forward to…" picker. Outside it
 * (the public demo) the best we can do is put the link on the clipboard. */
export async function shareClub(clubId: string, title: string): Promise<"shared" | "copied" | "failed"> {
  const link = clubShareLink(clubId);
  const tg = window.Telegram?.WebApp;
  if (tg?.openTelegramLink) {
    const url = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(title)}`;
    tg.openTelegramLink(url);
    return "shared";
  }
  try {
    await navigator.clipboard.writeText(link);
    return "copied";
  } catch {
    return "failed";
  }
}

/** The club id carried by a shared link, when the app was opened through one. */
export function getStartParam(): string | null {
  return window.Telegram?.WebApp?.initDataUnsafe?.start_param ?? null;
}

export function confirmDialog(message: string): Promise<boolean> {
  const tg = window.Telegram?.WebApp;
  if (tg?.showConfirm) {
    return new Promise((resolve) => tg.showConfirm!(message, resolve));
  }
  return Promise.resolve(window.confirm(message));
}

/** Cancelling a booking, asked in the school's own voice. showConfirm only
 * ever draws Cancel/OK, so the custom wording needs showPopup (Bot API 6.2+);
 * older clients fall back to the plain confirm. */
export function confirmCancelBooking(message: string): Promise<boolean> {
  const tg = window.Telegram?.WebApp;
  if (tg?.showPopup) {
    return new Promise((resolve) => {
      tg.showPopup!(
        {
          title: "ти куди...?",
          message,
          buttons: [
            { id: "leave", type: "destructive", text: "куди нада" },
            { id: "stay", type: "default", text: "жартую так" },
          ],
        },
        (id) => resolve(id === "leave"),
      );
    });
  }
  return confirmDialog(message);
}

declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        ready: () => void;
        expand: () => void;
        setHeaderColor: (color: string) => void;
        setBackgroundColor: (color: string) => void;
        initData: string;
        initDataUnsafe: { user?: { id: number; first_name: string }; start_param?: string };
        HapticFeedback: { impactOccurred: (style: string) => void };
        openLink: (url: string) => void;
        openTelegramLink?: (url: string) => void;
        disableVerticalSwipes?: () => void;
        close: () => void;
        showConfirm?: (message: string, callback: (confirmed: boolean) => void) => void;
        showPopup?: (
          params: {
            title?: string;
            message: string;
            buttons?: { id?: string; type?: string; text?: string }[];
          },
          callback?: (buttonId: string) => void,
        ) => void;
      };
    };
  }
}
