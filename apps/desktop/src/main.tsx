import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { lockBrowserChrome } from "./lib/lock-browser-chrome";
import "./styles/globals.css";

lockBrowserChrome();

const root = document.getElementById("root");
if (!root) {
  throw new Error("Arrab Studio root element is missing");
}

// Mount immediately. Device-cache hydrate must never block first paint — a hung
// Tauri IPC call used to leave the window permanently blank.
createRoot(root).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);

void import("./lib/device-cache")
  .then(({ hydrateDeviceCache }) =>
    Promise.race([
      hydrateDeviceCache(),
      new Promise<void>((resolve) => window.setTimeout(resolve, 1500)),
    ]),
  )
  .catch(() => undefined);
