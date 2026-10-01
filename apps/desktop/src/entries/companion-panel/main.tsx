import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CompanionPanelApp } from "./CompanionPanelApp";
import "./companion-panel.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Companion panel root missing");
}

createRoot(root).render(
  <StrictMode>
    <CompanionPanelApp />
  </StrictMode>,
);
