import type { ClientLimits } from "./types";

export type LimitLevel = "ok" | "warn80" | "warn95" | "blocked";

export type LimitMeter = {
  key: "messages" | "tokens";
  used: number;
  limit: number;
  ratio: number;
};

export type LimitStatus = {
  level: LimitLevel;
  /** The most-used meter decides the level. */
  worst: LimitMeter | null;
  meters: LimitMeter[];
  resetsAt: string | null;
};

function meter(key: LimitMeter["key"], used: number | null, limit: number | null): LimitMeter | null {
  if (limit === null || limit <= 0 || used === null || used < 0) return null;
  return { key, used, limit, ratio: used / limit };
}

export function levelForRatio(ratio: number): LimitLevel {
  if (ratio >= 1) return "blocked";
  if (ratio >= 0.95) return "warn95";
  if (ratio >= 0.8) return "warn80";
  return "ok";
}

/** Courtesy display only — the server always enforces limits. */
export function limitStatus(limits: ClientLimits | null | undefined): LimitStatus {
  if (!limits) return { level: "ok", worst: null, meters: [], resetsAt: null };
  const meters = [
    meter("messages", limits.messagesUsedToday, limits.messagesPerDay),
    meter("tokens", limits.tokensUsedThisMonth, limits.tokensPerMonth),
  ].filter((item): item is LimitMeter => item !== null);
  const worst = meters.reduce<LimitMeter | null>(
    (top, item) => (!top || item.ratio > top.ratio ? item : top),
    null,
  );
  return {
    level: worst ? levelForRatio(worst.ratio) : "ok",
    worst,
    meters,
    resetsAt: limits.resetsAt,
  };
}

/** A 402/429 from the server is the source of truth: surface its own message. */
export function serverLimitMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const status = (error as { status?: unknown }).status;
  if (status !== 402 && status !== 429) return null;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message : null;
}
