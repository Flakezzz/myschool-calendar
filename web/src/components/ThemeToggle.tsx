import { useState } from "react";
import { applyTheme, getEffectiveTheme, type ThemeMode } from "../lib/theme";
import { syncTelegramTheme } from "../lib/telegram";
import { MoonIcon, SunIcon } from "./ThemeIcons";

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
      <span className="theme-icon-stack">
        <SunIcon className={`theme-icon${mode === "light" ? " is-active" : ""}`} />
        <MoonIcon className={`theme-icon${mode === "dark" ? " is-active" : ""}`} />
      </span>
    </button>
  );
}
