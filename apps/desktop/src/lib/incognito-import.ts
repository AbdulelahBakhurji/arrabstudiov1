import type { IncognitoMessage } from "@/lib/incognito-vault";

export const INCOGNITO_IMPORT_KEY = "arrab.incognito.pendingImport";

export type PendingIncognitoImport = {
  title: string;
  messages: IncognitoMessage[];
};

export function stashIncognitoImport(payload: PendingIncognitoImport): void {
  try {
    sessionStorage.setItem(INCOGNITO_IMPORT_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

export function takeIncognitoImport(): PendingIncognitoImport | null {
  try {
    const raw = sessionStorage.getItem(INCOGNITO_IMPORT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(INCOGNITO_IMPORT_KEY);
    const parsed = JSON.parse(raw) as PendingIncognitoImport;
    if (!parsed?.title || !Array.isArray(parsed.messages)) return null;
    return parsed;
  } catch {
    return null;
  }
}
