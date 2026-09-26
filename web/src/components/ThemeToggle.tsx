import { useEffect, useState } from "react";
import { applyTheme, getStoredTheme, type ThemeMode } from "../lib/theme";

const ORDER: ThemeMode[] = ["system", "light", "dark"];
const LABELS: Record<ThemeMode, string> = {
  system: "Авто",
  light: "Світла",
  dark: "Темна",
};
const ICONS: Record<ThemeMode, string> = {
  system: "\u{1F5A5}️",
  light: "☀️",
  dark: "\u{1F319}",
};

export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>(getStoredTheme);

  useEffect(() => {
    applyTheme(mode);
  }, [mode]);

  const next = () => {
    setMode(ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length]);
  };

  return (
    <button type="button" className="theme-btn" onClick={next} aria-label="Тема оформлення">
      <span aria-hidden="true">{ICONS[mode]}</span> {LABELS[mode]}
    </button>
  );
}
