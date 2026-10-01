import type { StudioPrefs } from "@/shared/lib/prefs";

/** Pure delivery rules for background alerts — no DOM, no Tauri, so every rule is unit-tested. */

export type AlertKind = "approvals" | "teamLaunch" | "connector" | "cowork" | "agent";

export type Delivery = {
  /** In-app toast. */
  toast: boolean;
  /** Native OS notification (Notification Center / Action Center). */
  os: boolean;
  /** Floating agent presence HUD. */
  presence: boolean;
};

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseClock(value: string): number | null {
  const match = HHMM.exec(value.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** True while a manual snooze is running. */
export function isSnoozed(prefs: Pick<StudioPrefs, "dndUntil">, now: number): boolean {
  return prefs.dndUntil > now;
}

/** True inside the nightly quiet window; handles windows that wrap past midnight (22:00 → 07:00). */
export function isInQuietHours(
  prefs: Pick<StudioPrefs, "quietHoursEnabled" | "quietStart" | "quietEnd">,
  now: Date,
): boolean {
  if (!prefs.quietHoursEnabled) return false;
  const start = parseClock(prefs.quietStart);
  const end = parseClock(prefs.quietEnd);
  if (start === null || end === null || start === end) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

export function isQuietNow(prefs: StudioPrefs, now: Date = new Date()): boolean {
  return isSnoozed(prefs, now.getTime()) || isInQuietHours(prefs, now);
}

function kindEnabled(kind: AlertKind, prefs: StudioPrefs): boolean {
  switch (kind) {
    case "approvals":
      return prefs.notifyApprovals;
    case "teamLaunch":
      return prefs.notifyTeamLaunch;
    case "connector":
      return prefs.notifyConnector;
    case "cowork":
      return prefs.notifyCowork;
    case "agent":
      return prefs.notifyAgentPresence;
  }
}

/**
 * Decide how an alert is delivered. Everything is always kept in the inbox by the caller;
 * this only governs what interrupts the user.
 */
export function deliveryFor(kind: AlertKind, prefs: StudioPrefs, now: Date = new Date()): Delivery {
  if (!kindEnabled(kind, prefs)) return { toast: false, os: false, presence: false };
  const quiet = isQuietNow(prefs, now);
  if (!quiet) return { toast: true, os: true, presence: prefs.notifyAgentPresence };
  // Quiet: approvals may break through (they block an agent waiting on you), nothing else does.
  const breakThrough = kind === "approvals" && prefs.quietAllowApprovals;
  return { toast: breakThrough, os: breakThrough, presence: false };
}

/** Preset snooze lengths. "tomorrow" ends at the next 08:00 local time. */
export type SnoozeChoice = "30m" | "1h" | "4h" | "tomorrow" | "off";

export function snoozeUntil(choice: SnoozeChoice, now: Date = new Date()): number {
  if (choice === "off") return 0;
  if (choice === "tomorrow") {
    const next = new Date(now);
    next.setDate(next.getDate() + (now.getHours() >= 8 ? 1 : 0));
    next.setHours(8, 0, 0, 0);
    return next.getTime();
  }
  const minutes = choice === "30m" ? 30 : choice === "1h" ? 60 : 240;
  return now.getTime() + minutes * 60_000;
}

/**
 * Stops floods: the same tag within `dedupeMs` is dropped, and at most `maxPerWindow`
 * OS notifications go out per `windowMs`, so a looping agent can't bury the Notification Center.
 */
export function createOsThrottle(options?: { dedupeMs?: number; windowMs?: number; maxPerWindow?: number }) {
  const dedupeMs = options?.dedupeMs ?? 4_000;
  const windowMs = options?.windowMs ?? 10_000;
  const maxPerWindow = options?.maxPerWindow ?? 4;
  const lastByTag = new Map<string, number>();
  let sent: number[] = [];
  return {
    allow(tag: string, now: number = Date.now()): boolean {
      const last = lastByTag.get(tag);
      if (last !== undefined && now - last < dedupeMs) return false;
      sent = sent.filter((at) => now - at < windowMs);
      if (sent.length >= maxPerWindow) return false;
      lastByTag.set(tag, now);
      sent.push(now);
      if (lastByTag.size > 200) {
        for (const [key, at] of lastByTag) if (now - at > windowMs) lastByTag.delete(key);
      }
      return true;
    },
  };
}

/** Remembers the last OS notification so focusing the app soon after can deep-link to it. */
export function createPendingLink(ttlMs = 60_000) {
  let pending: { href: string; at: number } | null = null;
  return {
    set(href: string | undefined, now: number = Date.now()) {
      pending = href ? { href, at: now } : null;
    },
    take(now: number = Date.now()): string | null {
      const current = pending;
      pending = null;
      return current && now - current.at <= ttlMs ? current.href : null;
    },
  };
}

/** Title-bar / taskbar label: "(3) Arrab Studio". Capped so a runaway count stays readable. */
export function badgeTitle(unread: number, base = "Arrab Studio"): string {
  if (unread <= 0) return base;
  return `(${unread > 99 ? "99+" : unread}) ${base}`;
}
