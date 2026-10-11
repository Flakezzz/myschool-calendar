import { useState } from "react";
import { Emoji } from "./Emoji";
import { applyTheme, getEffectiveTheme, type ThemeMode } from "../lib/theme";
import { syncTelegramTheme } from "../lib/telegram";

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
      {/* The sun and the moon are emoji in her Figma, not drawn icons. */}
      <span className="theme-icon-stack" aria-hidden="true">
        <span className={`theme-icon${mode === "light" ? " is-active" : ""}`}>
          <Emoji>🌞</Emoji>
        </span>
        <span className={`theme-icon${mode === "dark" ? " is-active" : ""}`}>
          <Emoji>🌝</Emoji>
        </span>
      </span>
    </button>
  );
}
