import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initTelegram, syncTelegramTheme } from "./lib/telegram";
import { getEffectiveTheme } from "./lib/theme";
import "./styles.css";

initTelegram();
syncTelegramTheme(getEffectiveTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
