const BG_BY_THEME = { light: "#f4efe6", dark: "#14181f" } as const;

export function initTelegram() {
  const tg = window.Telegram?.WebApp;
  if (!tg) return;
  tg.ready();
  tg.expand();
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
        initDataUnsafe: { user?: { id: number; first_name: string } };
        HapticFeedback: { impactOccurred: (style: string) => void };
        openLink: (url: string) => void;
        close: () => void;
        showConfirm?: (message: string, callback: (confirmed: boolean) => void) => void;
      };
    };
  }
}
