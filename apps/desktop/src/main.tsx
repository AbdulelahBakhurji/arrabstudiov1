import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { lockBrowserChrome } from "./lib/lock-browser-chrome";
import "./styles/globals.css";

lockBrowserChrome();

const root = document.getElementById("root");
if (!root) {
  throw new Error("Arrab Studio root element is missing");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
