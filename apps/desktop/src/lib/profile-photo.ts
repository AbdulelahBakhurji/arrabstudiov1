/**
 * The person's own picture — separate from any one companion, shown next to
 * their name in the header and on the "Me" page. Local-only, same as
 * companion avatars: nothing here goes through the account API.
 */
import { useSyncExternalStore } from "react";

export const PROFILE_PHOTO_KEY = "arrab.profile.photo";
const EVENT = "arrab:profile-photo";

export function getProfilePhoto(): string | null {
  try {
    return localStorage.getItem(PROFILE_PHOTO_KEY);
  } catch {
    return null;
  }
}

export function setProfilePhoto(photo: string | null): void {
  try {
    if (photo) {
      localStorage.setItem(PROFILE_PHOTO_KEY, photo);
    } else {
      localStorage.removeItem(PROFILE_PHOTO_KEY);
    }
  } catch {
    // over quota — nothing to persist, the in-memory session still reflects it via the event below
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.key === PROFILE_PHOTO_KEY) listener();
  };
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useProfilePhoto(): string | null {
  return useSyncExternalStore(subscribe, getProfilePhoto, () => null);
}
