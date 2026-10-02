import { invoke } from "@tauri-apps/api/core";
import { deviceStoreGet, deviceStoreRemove, deviceStoreSet } from "../storage/device-store";
import { isTauriRuntime } from "./terminal";

/**
 * Where small secrets (encryption keys, tokens) live.
 *
 * Adapters, by platform:
 *  - macOS desktop:   Keychain (native `secure_*` commands)            — implemented
 *  - Windows desktop: Credential Manager / DPAPI                       — planned (falls back to file store)
 *  - Linux desktop:   Secret Service                                   — planned (falls back to file store)
 *  - iOS:             Keychain (native client)                         — native client's job
 *  - Android/Huawei:  Android Keystore-backed storage (no GMS needed) — native client's job
 */
export interface SecureStorage {
  /** `os-keychain` = protected by the OS; `file` = app-data file only (no OS protection). */
  readonly protection: "os-keychain" | "file";
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const FILE_NAMESPACE = "secure" as const;

class FileSecureStorage implements SecureStorage {
  readonly protection = "file" as const;
  get(key: string) {
    return deviceStoreGet(FILE_NAMESPACE, key);
  }
  set(key: string, value: string) {
    return deviceStoreSet(FILE_NAMESPACE, key, value);
  }
  remove(key: string) {
    return deviceStoreRemove(FILE_NAMESPACE, key);
  }
}

class KeychainSecureStorage implements SecureStorage {
  readonly protection = "os-keychain" as const;
  constructor(private readonly legacy: SecureStorage) {}

  async get(key: string) {
    const value = await invoke<string | null>("secure_get", { key });
    if (value != null) return value;
    // One-time migration: a secret written before the Keychain existed moves into it and its file copy is removed.
    const old = await this.legacy.get(key);
    if (old != null) {
      await this.set(key, old);
      await this.legacy.remove(key);
    }
    return old;
  }
  async set(key: string, value: string) {
    await invoke("secure_set", { key, value });
  }
  async remove(key: string) {
    await invoke("secure_delete", { key });
    await this.legacy.remove(key);
  }
}

let instance: Promise<SecureStorage> | null = null;

/** Resolve the best store this platform offers (decided once). */
export function getSecureStorage(): Promise<SecureStorage> {
  if (!instance) {
    instance = (async () => {
      const file = new FileSecureStorage();
      if (!isTauriRuntime()) return file;
      try {
        const keychain = await invoke<boolean>("secure_storage_available");
        return keychain ? new KeychainSecureStorage(file) : file;
      } catch {
        return file;
      }
    })();
  }
  return instance;
}
