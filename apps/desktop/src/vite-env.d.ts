/// <reference types="vite/client" />

declare module "*.png" {
  const src: string;
  export default src;
}

interface ImportMetaEnv {
  readonly VITE_ARRAB_API_URL: string;
  /** Optional path prefix before /health and /v1 (e.g. /r/nmpi6uidtpkh1bdf). */
  readonly VITE_ARRAB_API_ROUTE_PREFIX?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
