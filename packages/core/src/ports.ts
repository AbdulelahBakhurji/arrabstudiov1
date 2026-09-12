import type { Activity } from "@arrab/shared";

export interface Clock {
  now(): Date;
  isoNow(): string;
}

export const systemClock: Clock = {
  now: () => new Date(),
  isoNow: () => new Date().toISOString(),
};

export interface IdGenerator {
  next(prefix: string): string;
}

export const randomIdGenerator: IdGenerator = {
  next(prefix: string): string {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${prefix}_${hex}`;
  },
};

export interface ActivityLogger {
  record(entry: Omit<Activity, "id" | "createdAt"> & { id?: Activity["id"] }): Promise<void>;
}

export type AuthPrincipal =
  | { type: "anonymous" }
  | { type: "user"; userId: string; organizationId: string; workspaceId: string | null };

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number | null;
}

export interface RateLimiter {
  consume(key: string): Promise<RateLimitDecision>;
}
