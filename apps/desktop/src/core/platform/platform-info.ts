/**
 * Which platform is this client running on?
 *
 * Business code asks `platformInfo()` (or a capability from `./services`) instead of sniffing the
 * user agent, so macOS / Windows / iOS / Android / Huawei differences live behind one boundary.
 */
export type PlatformOs =
  "macos" | "windows" | "linux" | "ios" | "android" | "huawei" | "web" | "unknown";
export type PlatformForm = "desktop" | "mobile" | "web";

export interface PlatformInfo {
  os: PlatformOs;
  form: PlatformForm;
  /** Running inside the Tauri shell (desktop). Mobile clients are native and report `false`. */
  shell: "tauri" | "browser" | "native";
  /** Google Mobile Services are not assumed: Huawei devices do not have them. */
  hasGoogleServices: boolean;
}

export function detectPlatformFromAgent(userAgent: string, tauri: boolean): PlatformInfo {
  const ua = userAgent.toLowerCase();
  let os: PlatformOs = "unknown";
  // Huawei first: its Android devices (HMS) identify as Android but also as HUAWEI / HMSCore / HarmonyOS.
  if (/huawei|honor|hmscore|harmonyos/.test(ua)) os = "huawei";
  else if (/android/.test(ua)) os = "android";
  else if (/iphone|ipad|ipod/.test(ua)) os = "ios";
  else if (/mac os x|macintosh/.test(ua)) os = "macos";
  else if (/windows/.test(ua)) os = "windows";
  else if (/linux|x11/.test(ua)) os = "linux";
  else if (ua) os = "web";

  const mobile = os === "ios" || os === "android" || os === "huawei";
  return {
    os,
    form: mobile ? "mobile" : tauri ? "desktop" : "web",
    shell: tauri ? "tauri" : mobile ? "native" : "browser",
    hasGoogleServices: os !== "huawei",
  };
}

let cached: PlatformInfo | null = null;

export function platformInfo(): PlatformInfo {
  if (!cached) {
    const tauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
    cached = detectPlatformFromAgent(
      typeof navigator === "undefined" ? "" : navigator.userAgent,
      tauri,
    );
  }
  return cached;
}

/** Test hook. */
export function resetPlatformInfoForTests(): void {
  cached = null;
}
