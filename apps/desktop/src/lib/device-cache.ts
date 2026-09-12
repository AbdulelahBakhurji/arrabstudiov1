import {
  deviceStoreClear,
  deviceStoreGet,
  deviceStoreKeys,
  deviceStoreRemove,
  deviceStoreSet,
} from "./device-store";

const ARRAB_PREFIX = "arrab.";
let patched = false;

function nativeSetItem(key: string, value: string): void {
  Storage.prototype.setItem.call(localStorage, key, value);
}

function shouldMirror(key: string): boolean {
  return key.startsWith(ARRAB_PREFIX) && !key.startsWith("arrab.device.");
}

/** Copy webview cache onto disk and restore missing keys from this device. */
export async function hydrateDeviceCache(): Promise<void> {
  try {
    const stored = await deviceStoreKeys("cache");
    for (const key of stored) {
      if (!shouldMirror(key)) {
        continue;
      }
      if (localStorage.getItem(key) != null) {
        continue;
      }
      const value = await deviceStoreGet("cache", key);
      if (value != null) {
        nativeSetItem(key, value);
      }
    }

    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || !shouldMirror(key)) {
        continue;
      }
      const value = localStorage.getItem(key);
      if (value != null) {
        await deviceStoreSet("cache", key, value);
      }
    }
  } catch {
    // Cache hydrate is best-effort.
  }

  if (patched || typeof window === "undefined") {
    return;
  }
  patched = true;

  const originalSet = localStorage.setItem.bind(localStorage);
  const originalRemove = localStorage.removeItem.bind(localStorage);

  localStorage.setItem = (key: string, value: string) => {
    originalSet(key, value);
    if (shouldMirror(key)) {
      void deviceStoreSet("cache", key, value);
    }
  };

  localStorage.removeItem = (key: string) => {
    originalRemove(key);
    if (shouldMirror(key)) {
      void deviceStoreRemove("cache", key);
    }
  };
}

export async function clearDeviceCache(): Promise<void> {
  await deviceStoreClear("cache");
}
