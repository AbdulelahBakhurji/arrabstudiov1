import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LanguageProvider } from "@/i18n/LanguageProvider";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { UpdaterApp } from "./UpdaterApp";
import "@/styles/globals.css";
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
