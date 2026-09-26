import { useState } from "react";
import { applyTheme, getEffectiveTheme, type ThemeMode } from "../lib/theme";
import { syncTelegramTheme } from "../lib/telegram";

const ICONS: Record<ThemeMode, string> = {
  light: "☀️",
  dark: "\u{1F319}",
};

export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>(getEffectiveTheme);

  const toggle = () => {
    const next: ThemeMode = mode === "dark" ? "light" : "dark";
    applyTheme(next);
    syncTelegramTheme(next);
    setMode(next);
  };

  return (
    <button type="button" className="theme-btn" onClick={toggle} aria-label="Змінити тему">
      <span key={mode} className="theme-icon" aria-hidden="true">
        {ICONS[mode]}
      </span>
    </button>
  );
}
