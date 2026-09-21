import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AgentPresenceApp } from "./AgentPresenceApp";
import "./agent-presence.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Agent presence root missing");
}

createRoot(root).render(
  <StrictMode>
    <AgentPresenceApp />
  </StrictMode>,
);
