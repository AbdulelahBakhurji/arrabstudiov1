import type { ConnectorProvider } from "./api-contract.js";

/** Every provider the API can connect. Arrab Control can only curate these. */
export const CONNECTOR_PROVIDERS = [
  "gmail",
  "outlook",
  "email",
  "github",
  "gitlab",
  "bitbucket",
  "linear",
  "slack",
  "notion",
  "whatsapp",
  "openwa",
  "ssh",
  "finnhub",
  "whoop",
  "fitbit",
  "google_drive",
  "google_calendar",
  "figma",
] as const satisfies readonly ConnectorProvider[];

export type ControlConnectorStatus = "published" | "hidden";

/**
 * Arrab Control's catalog entry for a built-in connector. Providers without an
 * entry keep their default in-app listing; `null` fields fall back to the
 * app's built-in copy and logo.
 */
export type ControlConnector = {
  provider: ConnectorProvider;
  status: ControlConnectorStatus;
  featured: boolean;
  /** Lower sorts first; null keeps the default position. */
  order: number | null;
  name: string | null;
  nameAr: string | null;
  description: string | null;
  descriptionAr: string | null;
  /** https image URL that replaces the built-in brand mark. */
  logoUrl: string | null;
  updatedAt: string;
};
