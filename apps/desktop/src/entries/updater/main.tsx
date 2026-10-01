import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LanguageProvider } from "@/shared/i18n/LanguageProvider";
import { ThemeProvider } from "@/shared/theme/ThemeProvider";
import { UpdaterApp } from "./UpdaterApp";
import "@/shared/styles/globals.css";
import "./updater.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Updater root missing");
}

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <LanguageProvider>
        <UpdaterApp />
      </LanguageProvider>
    </ThemeProvider>
  </StrictMode>,
);
