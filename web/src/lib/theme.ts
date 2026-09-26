export type ThemeMode = "system" | "light" | "dark";

export function getStoredTheme(): ThemeMode {
  try {
    const v = localStorage.getItem("theme");
    if (v === "light" || v === "dark") return v;
  } catch {
    // ignore
  }
  return "system";
}

export function applyTheme(mode: ThemeMode) {
  if (mode === "system") {
    delete document.documentElement.dataset.theme;
    try {
      localStorage.removeItem("theme");
    } catch {
      // ignore
    }
  } else {
    document.documentElement.dataset.theme = mode;
    try {
      localStorage.setItem("theme", mode);
    } catch {
      // ignore
    }
  }
}
