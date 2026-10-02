import { invoke } from "@tauri-apps/api/core";
import { deviceStoreGet, deviceStoreGetJson, deviceStoreSet, deviceStoreSetJson } from "@/core/storage/device-store";
import { isTauriRuntime } from "@/core/platform/terminal";
import type { ClientCapability, ClientPlatform, ClientVendor, PushProvider } from "./types";

const DEVICE_ID_KEY = "managed.deviceId";
const PUSH_KEY = "managed.push";
const LEGACY_DEVICE_ID_KEY = "arrab.deviceId";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DeviceIdentity = {
  deviceId: string;
  platform: ClientPlatform;
  vendor: ClientVendor;
  osVersion: string;
  pushProvider: PushProvider;
  pushToken: string | null;
  capabilities: ClientCapability[];
};

export type PushRegistration = { provider: PushProvider; token: string | null };

let cachedDeviceId: string | null = null;
let cachedOsVersion: string | null = null;
let cachedPush: PushRegistration | null = null;

function newDeviceId(): string {
  return crypto.randomUUID();
}

export function isUuidV4(value: unknown): value is string {
  return typeof value === "string" && UUID_V4.test(value);
}

/** Random UUID v4 created on first launch; never derived from hardware. */
export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;
  const stored = await deviceStoreGet("secure", DEVICE_ID_KEY);
  if (isUuidV4(stored)) {
    cachedDeviceId = stored;
    return stored;
  }
  let legacy: string | null = null;
  try {
    legacy = localStorage.getItem(LEGACY_DEVICE_ID_KEY);
    localStorage.removeItem(LEGACY_DEVICE_ID_KEY);
  } catch {
    // ignore
  }
  const id = isUuidV4(legacy) ? legacy : newDeviceId();
  cachedDeviceId = id;
  await deviceStoreSet("secure", DEVICE_ID_KEY, id);
  return id;
}

/**
 * Rotate the managed-client device id (fresh push identity).
 * Account sessions are separate: use `arrabApi.revokeAllAccountSessions()` / Account → Security.
 */
export async function resetDeviceId(): Promise<string> {
  const id = newDeviceId();
  cachedDeviceId = id;
  await deviceStoreSet("secure", DEVICE_ID_KEY, id);
  await setPushRegistration({ provider: cachedPush?.provider ?? "none", token: null });
  return id;
}

export function detectPlatform(ua: string, maxTouchPoints = 0): ClientPlatform {
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1)) return "ipados";
  if (/iPhone|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macos";
  if (/Windows/i.test(ua)) return "windows";
  return "linux";
}

export function detectVendor(platform: ClientPlatform, ua: string): ClientVendor {
  if (platform === "macos" || platform === "ios" || platform === "ipados") return "apple";
  if (platform === "windows") return "microsoft";
  if (platform !== "android") return "other";
  if (/SAMSUNG|SM-[A-Z0-9]/i.test(ua)) return "samsung";
  if (/HUAWEI|HONOR|HarmonyOS/i.test(ua)) return "huawei";
  if (/Pixel/i.test(ua)) return "google";
  if (/Xiaomi|Redmi|POCO|\bMi\s/i.test(ua)) return "xiaomi";
  return "other";
}

function osVersionFromUa(ua: string): string {
  const mac = /Mac OS X (\d+[._]\d+(?:[._]\d+)?)/.exec(ua);
  if (mac) return mac[1]!.replace(/_/g, ".");
  const win = /Windows NT (\d+\.\d+)/.exec(ua);
  if (win) return win[1]!;
  const ios = /OS (\d+_\d+(?:_\d+)?) like Mac OS X/.exec(ua);
  if (ios) return ios[1]!.replace(/_/g, ".");
  const android = /Android (\d+(?:\.\d+)*)/.exec(ua);
  if (android) return android[1]!;
  return "unknown";
}

async function osVersion(ua: string): Promise<string> {
  if (cachedOsVersion) return cachedOsVersion;
  if (isTauriRuntime()) {
    try {
      const native = await invoke<string>("managed_os_version");
      if (native.trim()) {
        cachedOsVersion = native.trim().slice(0, 40);
        return cachedOsVersion;
      }
    } catch {
      // older shell — fall back to the user agent
    }
  }
  cachedOsVersion = osVersionFromUa(ua);
  return cachedOsVersion;
}

export async function getPushRegistration(): Promise<PushRegistration> {
  if (cachedPush) return cachedPush;
  const stored = await deviceStoreGetJson<PushRegistration>("secure", PUSH_KEY);
  cachedPush =
    stored && typeof stored.provider === "string"
      ? { provider: stored.provider, token: typeof stored.token === "string" ? stored.token : null }
      : { provider: "none", token: null };
  return cachedPush;
}

/** Called by the mobile push bridge whenever the OS issues or rotates a token. */
export async function setPushRegistration(next: PushRegistration): Promise<void> {
  cachedPush = next;
  await deviceStoreSetJson("secure", PUSH_KEY, next);
}

function capabilitiesFor(platform: ClientPlatform, push: PushRegistration): ClientCapability[] {
  const caps: ClientCapability[] = ["local_notifications", "deep_link"];
  if (push.provider !== "none" && push.token) caps.push("remote_push");
  if (platform === "macos" || platform === "windows" || platform === "linux") {
    caps.push("auto_update", "menu_bar");
  }
  return caps;
}

export async function getDeviceIdentity(): Promise<DeviceIdentity> {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const touch = typeof navigator !== "undefined" ? navigator.maxTouchPoints ?? 0 : 0;
  const platform = detectPlatform(ua, touch);
  const [deviceId, version, push] = await Promise.all([
    getDeviceId(),
    osVersion(ua),
    getPushRegistration(),
  ]);
  const desktop = platform === "macos" || platform === "windows" || platform === "linux";
  return {
    deviceId,
    platform,
    vendor: detectVendor(platform, ua),
    osVersion: version,
    pushProvider: desktop ? "none" : push.provider,
    pushToken: desktop ? null : push.token,
    capabilities: capabilitiesFor(platform, push),
  };
}
