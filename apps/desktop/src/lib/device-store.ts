import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./terminal";

export type DeviceStoreNamespace = "cache" | "chats" | "incognito";

const LS_PREFIX = "arrab.device.";

function memoryKey(namespace: DeviceStoreNamespace, key: string): string {
  return `${LS_PREFIX}${namespace}.${key}`;
}

export async function deviceStoreGet(
  namespace: DeviceStoreNamespace,
  key: string,
): Promise<string | null> {
  if (isTauriRuntime()) {
    try {
      const value = await invoke<string | null>("device_store_get", { namespace, key });
      if (value != null) {
        return value;
      }
    } catch {
      // Fall through to the webview copy.
    }
  }
  try {
    return localStorage.getItem(memoryKey(namespace, key));
  } catch {
    return null;
  }
}

export async function deviceStoreSet(
  namespace: DeviceStoreNamespace,
  key: string,
  value: string,
): Promise<void> {
  try {
    localStorage.setItem(memoryKey(namespace, key), value);
  } catch {
    // Quota or private mode — still try the native store.
  }
  if (!isTauriRuntime()) {
    return;
  }
  try {
    await invoke("device_store_set", { namespace, key, value });
  } catch {
    // Native store is best-effort; localStorage still holds a copy.
  }
}

export async function deviceStoreRemove(
  namespace: DeviceStoreNamespace,
  key: string,
): Promise<void> {
  try {
    localStorage.removeItem(memoryKey(namespace, key));
  } catch {
    // ignore
  }
  if (!isTauriRuntime()) {
    return;
  }
  try {
    await invoke("device_store_remove", { namespace, key });
  } catch {
    // ignore
  }
}

export async function deviceStoreKeys(
  namespace: DeviceStoreNamespace,
  prefix = "",
): Promise<string[]> {
  const keys = new Set<string>();
  if (isTauriRuntime()) {
    try {
      const native = await invoke<string[]>("device_store_keys", {
        namespace,
        prefix: prefix || null,
      });
      for (const key of native) {
        keys.add(key);
      }
    } catch {
      // ignore
    }
  }
  const needle = memoryKey(namespace, prefix);
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const full = localStorage.key(index);
      if (!full || !full.startsWith(`${LS_PREFIX}${namespace}.`)) {
        continue;
      }
      const key = full.slice(`${LS_PREFIX}${namespace}.`.length);
      if (!prefix || key.startsWith(prefix) || full.startsWith(needle)) {
        keys.add(key);
      }
    }
  } catch {
    // ignore
  }
  return [...keys].sort();
}

export async function deviceStoreClear(namespace: DeviceStoreNamespace): Promise<void> {
  const keys = await deviceStoreKeys(namespace);
  for (const key of keys) {
    try {
      localStorage.removeItem(memoryKey(namespace, key));
    } catch {
      // ignore
    }
  }
  if (!isTauriRuntime()) {
    return;
  }
  try {
    await invoke("device_store_clear", { namespace });
  } catch {
    // ignore
  }
}

export async function deviceStoreGetJson<T>(
  namespace: DeviceStoreNamespace,
  key: string,
): Promise<T | null> {
  const raw = await deviceStoreGet(namespace, key);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function deviceStoreSetJson(
  namespace: DeviceStoreNamespace,
  key: string,
  value: unknown,
): Promise<void> {
  await deviceStoreSet(namespace, key, JSON.stringify(value));
}
