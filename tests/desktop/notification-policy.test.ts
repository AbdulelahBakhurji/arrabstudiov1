import { describe, expect, it } from "vitest";
import {
  badgeTitle,
  createOsThrottle,
  createPendingLink,
  deliveryFor,
  isInQuietHours,
  isQuietNow,
  parseClock,
  snoozeUntil,
} from "../../apps/desktop/src/domains/notifications/notification-policy";
import { defaultPrefs } from "../../apps/desktop/src/shared/lib/prefs";

const at = (h: number, m = 0, day = 15) => new Date(2026, 9, day, h, m, 0, 0);

describe("quiet hours", () => {
  const quiet = { ...defaultPrefs(), quietHoursEnabled: true, quietStart: "22:00", quietEnd: "07:00" };

  it("parses HH:MM and rejects junk", () => {
    expect(parseClock("07:30")).toBe(450);
    expect(parseClock("24:00")).toBeNull();
    expect(parseClock("7:30")).toBeNull();
  });

  it("covers a window that wraps past midnight", () => {
    expect(isInQuietHours(quiet, at(23, 0))).toBe(true);
    expect(isInQuietHours(quiet, at(3, 30))).toBe(true);
    expect(isInQuietHours(quiet, at(7, 0))).toBe(false);
    expect(isInQuietHours(quiet, at(12, 0))).toBe(false);
    expect(isInQuietHours(quiet, at(22, 0))).toBe(true);
  });

  it("handles a same-day window and ignores empty ones", () => {
    const lunch = { ...quiet, quietStart: "12:00", quietEnd: "13:00" };
    expect(isInQuietHours(lunch, at(12, 30))).toBe(true);
    expect(isInQuietHours(lunch, at(13, 0))).toBe(false);
    expect(isInQuietHours({ ...quiet, quietStart: "08:00", quietEnd: "08:00" }, at(8, 0))).toBe(false);
    expect(isInQuietHours({ ...quiet, quietHoursEnabled: false }, at(23, 0))).toBe(false);
  });
});

describe("delivery", () => {
  it("delivers everything normally and respects per-kind toggles", () => {
    const prefs = defaultPrefs();
    expect(deliveryFor("approvals", prefs, at(12))).toEqual({ toast: true, os: true, presence: true });
    expect(deliveryFor("cowork", prefs, at(12))).toEqual({ toast: false, os: false, presence: false });
  });

  it("holds interruptions during quiet hours but lets approvals through", () => {
    const prefs = { ...defaultPrefs(), notifyCowork: true, quietHoursEnabled: true };
    expect(deliveryFor("connector", prefs, at(23))).toEqual({ toast: false, os: false, presence: false });
    expect(deliveryFor("approvals", prefs, at(23))).toEqual({ toast: true, os: true, presence: false });
    expect(deliveryFor("approvals", { ...prefs, quietAllowApprovals: false }, at(23)).os).toBe(false);
  });

  it("holds interruptions while snoozed and resumes afterwards", () => {
    const now = at(12);
    const prefs = { ...defaultPrefs(), dndUntil: snoozeUntil("1h", now) };
    expect(isQuietNow(prefs, now)).toBe(true);
    expect(deliveryFor("connector", prefs, now).os).toBe(false);
    expect(isQuietNow(prefs, new Date(now.getTime() + 61 * 60_000))).toBe(false);
  });
});

describe("snooze presets", () => {
  it("computes relative and next-morning ends", () => {
    const now = at(10, 0);
    expect(snoozeUntil("30m", now) - now.getTime()).toBe(30 * 60_000);
    expect(snoozeUntil("4h", now) - now.getTime()).toBe(240 * 60_000);
    expect(snoozeUntil("off", now)).toBe(0);
    expect(new Date(snoozeUntil("tomorrow", now)).getDate()).toBe(16);
    expect(new Date(snoozeUntil("tomorrow", at(5, 0))).getDate()).toBe(15);
    expect(new Date(snoozeUntil("tomorrow", now)).getHours()).toBe(8);
  });
});

describe("os throttle", () => {
  it("drops repeats of the same tag and caps bursts", () => {
    const throttle = createOsThrottle({ dedupeMs: 4000, windowMs: 10_000, maxPerWindow: 3 });
    expect(throttle.allow("a", 0)).toBe(true);
    expect(throttle.allow("a", 1000)).toBe(false);
    expect(throttle.allow("b", 1000)).toBe(true);
    expect(throttle.allow("c", 2000)).toBe(true);
    expect(throttle.allow("d", 3000)).toBe(false);
    expect(throttle.allow("d", 10_500)).toBe(true);
    expect(throttle.allow("a", 6000)).toBe(false);
  });
});

describe("pending deep link", () => {
  it("is consumed once and expires", () => {
    const link = createPendingLink(60_000);
    link.set("/approvals", 0);
    expect(link.take(30_000)).toBe("/approvals");
    expect(link.take(31_000)).toBeNull();
    link.set("/chat", 0);
    expect(link.take(61_000)).toBeNull();
    link.set(undefined, 0);
    expect(link.take(1)).toBeNull();
  });
});

describe("badge title", () => {
  it("shows the unread count and caps it", () => {
    expect(badgeTitle(0)).toBe("Arrab Studio");
    expect(badgeTitle(3)).toBe("(3) Arrab Studio");
    expect(badgeTitle(250)).toBe("(99+) Arrab Studio");
  });
});
