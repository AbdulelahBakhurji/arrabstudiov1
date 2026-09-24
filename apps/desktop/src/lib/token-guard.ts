/**
 * Token guard — when plan or session tokens are finished, stop AI work and pause.
 */
import { ApiRequestError } from "@/lib/api";
import { markAccountQuotaPaused, refreshAccountStatus } from "@/lib/use-signed-in-account";

export const TOKEN_GUARD_EVENT = "arrab:token-guard";

export type TokenGuardKind = "quota" | "session_budget";

export type TokenGuardDetail = {
  kind: TokenGuardKind;
  message: string;
};

function readErrorCode(error: unknown): string | null {
  if (error instanceof ApiRequestError && error.code) return error.code;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return null;
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? "");
}

/** True when the account/plan token pool is finished. */
export function isQuotaFinishedError(error: unknown): boolean {
  const code = readErrorCode(error);
  if (code === "QUOTA_EXCEEDED") return true;
  if (error instanceof ApiRequestError && error.status === 402) {
    const message = readErrorMessage(error);
    if (/SESSION_BUDGET|session budget/i.test(message)) return false;
    return /Paused —|token limit|quota|allowance|billing was due/i.test(message) || true;
  }
  return /Paused —.*token limit|Paused —.*billing was due|QUOTA_EXCEEDED|subscription token limit/i.test(
    readErrorMessage(error),
  );
}

/** True when this chat session's token budget is finished. */
export function isSessionBudgetFinishedError(error: unknown): boolean {
  const code = readErrorCode(error);
  if (code === "SESSION_BUDGET_EXCEEDED") return true;
  return /SESSION_BUDGET|session budget of .* used up/i.test(readErrorMessage(error));
}

export function isTokenGuardError(error: unknown): boolean {
  return isQuotaFinishedError(error) || isSessionBudgetFinishedError(error);
}

function emitGuard(detail: TokenGuardDetail): void {
  try {
    window.dispatchEvent(new CustomEvent(TOKEN_GUARD_EVENT, { detail }));
  } catch {
    // ignore
  }
}

/**
 * Stop + pause when tokens are finished.
 * - Plan quota → mark account paused (QuotaPauseScreen) and refresh status.
 * - Session budget → emit event so the active chat stops sending.
 * Returns a user-facing message when a guard fired, otherwise null.
 */
export function enforceTokenGuard(error: unknown): string | null {
  if (isSessionBudgetFinishedError(error)) {
    const message = readErrorMessage(error);
    emitGuard({ kind: "session_budget", message });
    return message;
  }
  if (isQuotaFinishedError(error)) {
    const message = readErrorMessage(error);
    markAccountQuotaPaused(message);
    emitGuard({ kind: "quota", message });
    void refreshAccountStatus({ silent: true });
    return message;
  }
  return null;
}

/** Throw before starting cloud AI when the cached plan is already over limit. */
export function assertTokensAvailable(): void {
  try {
    const raw = localStorage.getItem("arrab.account.status.cache");
    if (!raw) return;
    const parsed = JSON.parse(raw) as {
      status?: { entitlements?: { overLimit?: boolean; tokensUsed?: number; tokenLimit?: number | null } };
    };
    const entitlements = parsed?.status?.entitlements;
    if (!entitlements?.overLimit) return;
    const used = entitlements.tokensUsed?.toLocaleString?.() ?? "?";
    const limit =
      entitlements.tokenLimit == null ? "unlimited" : entitlements.tokenLimit.toLocaleString();
    throw new ApiRequestError(
      `Paused — token limit reached (${used} / ${limit}). Upgrade or wait for the next period.`,
      402,
      "QUOTA_EXCEEDED",
    );
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
    // ignore cache parse failures
  }
}

export function subscribeTokenGuard(
  listener: (detail: TokenGuardDetail) => void,
): () => void {
  const onEvent = (event: Event) => {
    const detail = (event as CustomEvent<TokenGuardDetail>).detail;
    if (detail) listener(detail);
  };
  window.addEventListener(TOKEN_GUARD_EVENT, onEvent);
  return () => window.removeEventListener(TOKEN_GUARD_EVENT, onEvent);
}
