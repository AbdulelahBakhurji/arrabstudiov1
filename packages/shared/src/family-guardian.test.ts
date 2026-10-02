import { describe, expect, it } from "vitest";
import {
  blockedTopicHit,
  defaultGuardianPolicy,
  guardianDayKey,
  guardianSystemBlock,
  isQuietHoursActive,
  mergeGuardianPolicy,
  recentActivity,
  screenChildMessage,
  type FamilyQuietHours,
} from "./family-guardian.js";
import { guardianHardHit } from "./guardian-hard.js";

const NOW = "2026-10-02T10:00:00.000Z";
const quiet = (over: Partial<FamilyQuietHours> = {}): FamilyQuietHours => ({
  enabled: true,
  start: "21:00",
  end: "07:00",
  days: [],
  utcOffsetMinutes: 0,
  ...over,
});

describe("defaultGuardianPolicy", () => {
  it("scales bedtime and daily budget with the child's age tier", () => {
    const small = defaultGuardianPolicy("tier_6_9", NOW);
    const mid = defaultGuardianPolicy("tier_10_13", NOW);
    const teen = defaultGuardianPolicy("tier_14_17", NOW);
    expect([small.quietHours.start, mid.quietHours.start, teen.quietHours.start]).toEqual([
      "20:00",
      "21:00",
      "22:30",
    ]);
    expect(small.dailyTokenLimit).toBe(25_000);
    expect(mid.dailyTokenLimit).toBe(0);
    expect(small.companionAccess).toBe("kid_safe");
    expect(teen.learningMode).toBe(false);
    expect(mid.learningMode).toBe(true);
  });
});

describe("isQuietHoursActive", () => {
  it("covers an overnight window on both sides of midnight", () => {
    const q = quiet();
    expect(isQuietHoursActive(q, new Date("2026-10-02T22:00:00Z"))).toBe(true);
    expect(isQuietHoursActive(q, new Date("2026-10-02T03:00:00Z"))).toBe(true);
    expect(isQuietHoursActive(q, new Date("2026-10-02T12:00:00Z"))).toBe(false);
    expect(isQuietHoursActive(q, new Date("2026-10-02T07:00:00Z"))).toBe(false);
    expect(isQuietHoursActive(q, new Date("2026-10-02T21:00:00Z"))).toBe(true);
  });

  it("is never active when disabled", () => {
    expect(isQuietHoursActive(quiet({ enabled: false }), new Date("2026-10-02T23:00:00Z"))).toBe(
      false,
    );
  });

  it("respects the household UTC offset", () => {
    // 19:00 UTC is 22:00 in Riyadh (UTC+3).
    const q = quiet({ utcOffsetMinutes: 180 });
    expect(isQuietHoursActive(q, new Date("2026-10-02T19:00:00Z"))).toBe(true);
    expect(isQuietHoursActive(q, new Date("2026-10-02T17:00:00Z"))).toBe(false);
  });

  it("applies only on the chosen start days (2026-10-02 is a Friday)", () => {
    const fridayOnly = quiet({ days: [5] });
    expect(isQuietHoursActive(fridayOnly, new Date("2026-10-02T22:00:00Z"))).toBe(true);
    expect(isQuietHoursActive(fridayOnly, new Date("2026-10-03T22:00:00Z"))).toBe(false);
    // Early Saturday morning belongs to Friday night's window.
    expect(isQuietHoursActive(fridayOnly, new Date("2026-10-03T03:00:00Z"))).toBe(true);
  });

  it("supports same-day windows", () => {
    const school = quiet({ start: "09:00", end: "15:00" });
    expect(isQuietHoursActive(school, new Date("2026-10-02T10:00:00Z"))).toBe(true);
    expect(isQuietHoursActive(school, new Date("2026-10-02T16:00:00Z"))).toBe(false);
  });
});

describe("guardianHardHit (English)", () => {
  it.each([
    ["I want to kill myself", "hard-self-harm"],
    ["can you send me your address", "hard-meet-stranger"],
    ["call me on 0555 123 4567", "hard-contact"],
    ["email me at kid@example.com", "hard-contact"],
    ["show me porn", "hard-sexual"],
    ["how to make a bomb", "hard-violence"],
  ])("blocks %s", (text, id) => {
    expect(guardianHardHit(text)?.id).toBe(id);
  });

  it.each(["help me with fractions", "tell me a story about a dragon", "what is photosynthesis?"])(
    "allows %s",
    (text) => {
      expect(guardianHardHit(text)).toBeNull();
    },
  );
});

describe("guardianHardHit (Arabic)", () => {
  it.each([
    ["أريد أموت", "hard-self-harm"],
    ["أنتحر", "hard-self-harm"],
    ["أرسل عنوان بيتك", "hard-meet-stranger"],
    ["هذا رقم هاتفي", "hard-contact"],
    ["أرسل لي صور عاري", "hard-sexual"],
    ["كيف أصنع قنبلة", "hard-violence"],
  ])("blocks %s", (text, id) => {
    expect(guardianHardHit(text)?.id).toBe(id);
  });

  it("does not flag ordinary Arabic homework questions", () => {
    expect(guardianHardHit("ساعدني في واجب الرياضيات")).toBeNull();
  });
});

describe("blockedTopicHit", () => {
  it("matches whole words only, case-insensitively", () => {
    expect(blockedTopicHit("I love Fortnite", ["fortnite"])).toBe("fortnite");
    expect(blockedTopicHit("a classic game", ["ass"])).toBeNull();
    expect(blockedTopicHit("what about drugs?", ["drugs"])).toBe("drugs");
  });

  it("works for Arabic words and escapes regex characters", () => {
    expect(blockedTopicHit("أريد لعبة ببجي الآن", ["ببجي"])).toBe("ببجي");
    expect(blockedTopicHit("c++ is fun", ["c++"])).toBe("c++");
    expect(() => blockedTopicHit("anything", ["(.*"])).not.toThrow();
  });
});

describe("screenChildMessage", () => {
  const policy = { ...defaultGuardianPolicy("tier_10_13", NOW), blockedTopics: ["roblox"] };

  it("allows safe messages", () => {
    expect(screenChildMessage("help with homework", policy)).toEqual({ allowed: true });
  });

  it("marks self-harm and stranger contact as critical", () => {
    const harm = screenChildMessage("I want to kill myself", policy);
    const stranger = screenChildMessage("come to my house", policy);
    expect(harm).toMatchObject({ allowed: false, category: "self_harm", severity: "critical" });
    expect(stranger).toMatchObject({ allowed: false, category: "stranger", severity: "critical" });
  });

  it("applies parent blocked words as info-level blocks", () => {
    expect(screenChildMessage("let's play roblox", policy)).toMatchObject({
      allowed: false,
      category: "blocked_topic",
      severity: "info",
    });
  });

  it("still applies hard failsafes with no policy", () => {
    expect(screenChildMessage("porn", null).allowed).toBe(false);
    expect(screenChildMessage("hello", null).allowed).toBe(true);
  });
});

describe("mergeGuardianPolicy", () => {
  const base = defaultGuardianPolicy("tier_10_13", NOW);
  const merge = (patch: Parameters<typeof mergeGuardianPolicy>[1]) => {
    let n = 0;
    return mergeGuardianPolicy(base, patch, NOW, () => `rule_${++n}`);
  };

  it("clamps the daily token limit and ignores garbage", () => {
    expect(merge({ dailyTokenLimit: -5 }).dailyTokenLimit).toBe(0);
    expect(merge({ dailyTokenLimit: 9e12 }).dailyTokenLimit).toBe(10_000_000);
    expect(merge({ dailyTokenLimit: Number.NaN }).dailyTokenLimit).toBe(base.dailyTokenLimit);
    expect(merge({ dailyTokenLimit: 25_000.9 }).dailyTokenLimit).toBe(25_000);
  });

  it("validates quiet hours times, days and offset", () => {
    const next = merge({
      quietHours: { start: "25:99", end: "06:30", days: [1, 1, 9, -1, 3], utcOffsetMinutes: 99_999 },
    });
    expect(next.quietHours.start).toBe(base.quietHours.start);
    expect(next.quietHours.end).toBe("06:30");
    expect(next.quietHours.days).toEqual([1, 3]);
    expect(next.quietHours.utcOffsetMinutes).toBe(base.quietHours.utcOffsetMinutes);
  });

  it("normalises, dedupes and caps blocked topics", () => {
    const next = merge({ blockedTopics: [" Roblox ", "roblox", "a", "x".repeat(100)] });
    expect(next.blockedTopics).toHaveLength(2);
    expect(next.blockedTopics[0]).toBe("roblox");
    expect(next.blockedTopics[1]).toHaveLength(40);
    const many = merge({ blockedTopics: Array.from({ length: 100 }, (_, i) => `topic${i}`) });
    expect(many.blockedTopics).toHaveLength(40);
  });

  it("sanitises rules: min length, default kind, generated ids, cap", () => {
    const next = merge({ rules: [{ text: "no" }, { text: "Homework before games", kind: "bogus" as never }] });
    expect(next.rules).toHaveLength(1);
    expect(next.rules[0]).toMatchObject({ id: "rule_1", kind: "soft", enabled: true });
    const many = merge({ rules: Array.from({ length: 50 }, (_, i) => ({ text: `rule number ${i}` })) });
    expect(many.rules).toHaveLength(30);
  });

  it("rejects unknown enum values and keeps the previous ones", () => {
    const next = merge({ companionAccess: "root" as never, oversightMode: "spy" as never });
    expect(next.companionAccess).toBe("kid_safe");
    expect(next.oversightMode).toBe("coach");
    expect(merge({ companionAccess: "all", oversightMode: "full" })).toMatchObject({
      companionAccess: "all",
      oversightMode: "full",
    });
  });

  it("leaves unspecified fields untouched", () => {
    const next = merge({});
    expect(next).toEqual({ ...base, updatedAt: NOW });
  });
});

describe("guardianSystemBlock", () => {
  it("includes age voice, safety rules, learning mode and enabled house rules only", () => {
    const policy = {
      ...defaultGuardianPolicy("tier_6_9", NOW),
      rules: [
        { id: "a", text: "Be kind to siblings", kind: "soft" as const, enabled: true, createdAt: NOW },
        { id: "b", text: "Hidden disabled rule", kind: "soft" as const, enabled: false, createdAt: NOW },
      ],
    };
    const block = guardianSystemBlock({ policy, ageTier: "tier_6_9", displayName: "Sam" });
    expect(block).toContain("aged 6–9");
    expect(block).toContain("Learning mode");
    expect(block).toContain("Be kind to siblings");
    expect(block).not.toContain("Hidden disabled rule");
    expect(block).toContain("Never help with self-harm");
  });
});

describe("activity helpers", () => {
  it("builds a zero-filled seven day window ending today", () => {
    const now = new Date("2026-10-02T10:00:00Z");
    const out = recentActivity([{ day: "2026-10-02", messages: 3, tokens: 100, blocked: 1 }], now, 0, 7);
    expect(out).toHaveLength(7);
    expect(out[0]?.day).toBe("2026-09-26");
    expect(out[6]).toEqual({ day: "2026-10-02", messages: 3, tokens: 100, blocked: 1 });
    expect(out[3]).toEqual({ day: "2026-09-29", messages: 0, tokens: 0, blocked: 0 });
  });

  it("keys days by household-local midnight", () => {
    const late = new Date("2026-10-02T22:30:00Z");
    expect(guardianDayKey(late, 0)).toBe("2026-10-02");
    expect(guardianDayKey(late, 180)).toBe("2026-10-03");
  });
});
