import {
  deviceStoreClear,
  deviceStoreGet,
  deviceStoreKeys,
  deviceStoreRemove,
  deviceStoreSet,
} from "./device-store";
import { ACCOUNT_EVENT } from "./account-session";
import { GUEST_LOCAL_KEY, isGuestLocalMode } from "./guest-mode";

const ARRAB_PREFIX = "arrab.";
const ACCOUNT_CACHE_KEY = "arrab.account.status.cache";
const ACCOUNT_SESSION_KEY = "arrab.account.session";
const STUDIO_ROLE_KEY = "arrab.studioRole";
const ACCOUNT_ID_KEY = "arrab.account.id";
let patched = false;

const storageProto = typeof Storage === "undefined" ? null : Storage.prototype;
const protoSetItem = storageProto?.setItem;
const protoRemoveItem = storageProto?.removeItem;

function isAccountBoundKey(key: string): boolean {
  return (
    key === ACCOUNT_SESSION_KEY ||
    key === ACCOUNT_CACHE_KEY ||
    key === ACCOUNT_ID_KEY ||
    key === STUDIO_ROLE_KEY
  );
}

function nativeSetItem(key: string, value: string): void {
  (protoSetItem ?? Storage.prototype.setItem).call(localStorage, key, value);
}

function shouldMirror(key: string): boolean {
  return key.startsWith(ARRAB_PREFIX) && !key.startsWith("arrab.device.");
}

function cacheSavedAt(raw: string | null): number {
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw) as { savedAt?: number };
    return typeof parsed.savedAt === "number" ? parsed.savedAt : 0;
  } catch {
    return 0;
  }
}

/**
 * Prefer the freshest signed-in account cache. Disk often has Business/Team
 * while a stale webview Free cache would otherwise win and hide org pages.
 */
function preferFresherAccountCache(diskValue: string | null): boolean {
  if (!diskValue) return false;
  const localRaw = localStorage.getItem(ACCOUNT_CACHE_KEY);
  if (localRaw == null) return true;
  return cacheSavedAt(diskValue) > cacheSavedAt(localRaw);
}

/** Copy webview cache onto disk and restore missing/stale keys from this device. */
export async function hydrateDeviceCache(): Promise<void> {
  let restoredSession = false;
  const guest = isGuestLocalMode();
  try {
    const stored = await deviceStoreKeys("cache");
    for (const key of stored) {
      if (!shouldMirror(key)) {
        continue;
      }
      // Guest local-only must never revive a cloud Business session from disk.
      if (guest && isAccountBoundKey(key)) {
        continue;
      }
      // A stale guest flag on disk must never hide a signed-in cloud account.
      if (key === GUEST_LOCAL_KEY && localStorage.getItem(ACCOUNT_SESSION_KEY)) {
        void deviceStoreRemove("cache", key);
        continue;
      }
      const diskValue = await deviceStoreGet("cache", key);
      if (diskValue == null || diskValue === "") {
        continue;
      }
      const localValue = localStorage.getItem(key);
      const shouldRestore =
        localValue == null ||
        (key === ACCOUNT_CACHE_KEY && preferFresherAccountCache(diskValue)) ||
        (key === ACCOUNT_SESSION_KEY && !localValue);
      if (!shouldRestore) {
        continue;
      }
      nativeSetItem(key, diskValue);
      if (key === ACCOUNT_SESSION_KEY || key === ACCOUNT_CACHE_KEY) {
        restoredSession = true;
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

  if (restoredSession && !isGuestLocalMode()) {
    try {
      window.dispatchEvent(new CustomEvent(ACCOUNT_EVENT));
    } catch {
      // ignore
    }
  }

  if (patched || typeof window === "undefined" || !storageProto || !protoSetItem || !protoRemoveItem) {
    return;
  }
  patched = true;

  // WebKit stores `localStorage.setItem = fn` as an item named "setItem"
  // instead of overriding the method, so wrap the prototype.
  protoRemoveItem.call(localStorage, "setItem");
  protoRemoveItem.call(localStorage, "removeItem");

  storageProto.setItem = function setItem(this: Storage, key: string, value: string) {
    protoSetItem.call(this, key, value);
    if (this === localStorage && shouldMirror(key)) {
      void deviceStoreSet("cache", key, value);
    }
  };

  storageProto.removeItem = function removeItem(this: Storage, key: string) {
    protoRemoveItem.call(this, key);
    if (this === localStorage && shouldMirror(key)) {
      void deviceStoreRemove("cache", key);
    }
  };
}

export async function clearDeviceCache(): Promise<void> {
  await deviceStoreClear("cache");
}
