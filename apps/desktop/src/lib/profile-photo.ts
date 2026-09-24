/**
 * The person's own picture — separate from any one companion, shown next to
 * their name in the header and on the "Me" page. Local-only, same as
 * companion avatars: nothing here goes through the account API.
 *
 * On Family plans each seat has its own photo key so switching profiles
 * never leaks another member's face.
 */
import { useSyncExternalStore } from "react";
import { readActiveFamilyMemberId } from "@/lib/family-session";

export const PROFILE_PHOTO_KEY = "arrab.profile.photo";
const EVENT = "arrab:profile-photo";

function seatKey(memberId?: string | null): string {
  const seat = memberId?.trim() || readActiveFamilyMemberId();
  return seat ? `${PROFILE_PHOTO_KEY}.${seat}` : PROFILE_PHOTO_KEY;
}

export function getProfilePhoto(memberId?: string | null): string | null {
  try {
    const key = seatKey(memberId);
    return localStorage.getItem(key) ?? (key === PROFILE_PHOTO_KEY ? null : localStorage.getItem(PROFILE_PHOTO_KEY));
  } catch {
    return null;
  }
}

export function setProfilePhoto(photo: string | null, memberId?: string | null): void {
  try {
    const key = seatKey(memberId);
    if (photo) {
      localStorage.setItem(key, photo);
    } else {
      localStorage.removeItem(key);
      if (key !== PROFILE_PHOTO_KEY) localStorage.removeItem(PROFILE_PHOTO_KEY);
    }
  } catch {
    // over quota — nothing to persist, the in-memory session still reflects it via the event below
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.key.startsWith(PROFILE_PHOTO_KEY)) listener();
  };
  const onFamily = () => listener();
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", onStorage);
  window.addEventListener("arrab:family-profile", onFamily);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("arrab:family-profile", onFamily);
  };
}

export function useProfilePhoto(): string | null {
  return useSyncExternalStore(subscribe, getProfilePhoto, () => null);
}
