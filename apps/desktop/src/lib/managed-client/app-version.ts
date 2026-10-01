import pkg from "../../../package.json";

export const APP_VERSION: string = pkg.version;
export const APP_CHANNEL: string =
  (import.meta.env.VITE_ARRAB_CHANNEL as string | undefined)?.trim() || "stable";
