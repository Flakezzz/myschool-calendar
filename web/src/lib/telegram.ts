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

export function getTelegramUserId(): string | null {
  const id = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
  return id ? String(id) : null;
}

export function getTelegramInitData(): string {
  return window.Telegram?.WebApp?.initData ?? "";
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
      };
    };
  }
}
