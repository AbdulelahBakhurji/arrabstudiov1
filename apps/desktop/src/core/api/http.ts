import { readAccountSessionToken } from "@/domains/account/account-session";
import { normalizeApiRoutePrefix, readApiBaseOverride, readApiRoutePrefixOverride, splitApiBaseAndPrefix, writeApiBaseOverride, writeApiRoutePrefixOverride } from "@/shared/lib/prefs";
import { isTauriRuntime } from "@/core/platform/terminal";
import { invoke } from "@tauri-apps/api/core";


export const envSplit = splitApiBaseAndPrefix(
  import.meta.env.VITE_ARRAB_API_URL ?? "http://127.0.0.1:8787",
);
export const envApiBaseUrl = envSplit.base;
export const envApiRoutePrefix = normalizeApiRoutePrefix(
  import.meta.env.VITE_ARRAB_API_ROUTE_PREFIX || envSplit.prefix || "",
);

export const DEAD_API_HOSTS = /185\.197\.250\.43/i;

/** Origin (scheme + host) for the Arrab API — no path prefix. */
export function getApiBaseUrl(): string {
  const override = readApiBaseOverride();
  if (override && DEAD_API_HOSTS.test(override)) {
    writeApiBaseOverride(null);
    return envApiBaseUrl;
  }
  const raw = override ?? envApiBaseUrl;
  const { base, prefix } = splitApiBaseAndPrefix(raw);
  // Heal prefs that stored Coolify path inside the base URL field.
  if (override && prefix && override !== base) {
    writeApiBaseOverride(base);
    if (readApiRoutePrefixOverride() === null) {
      writeApiRoutePrefixOverride(prefix);
    }
  }
  return base;
}

/** Optional Coolify/Traefik path prefix before `/health` and `/v1/*`. */
export function getApiRoutePrefix(): string {
  const override = readApiRoutePrefixOverride();
  if (override !== null) return override;
  // Never glue a production proxy path onto a local API host.
  if (isLocalApiBase(getApiBaseUrl())) return "";
  return envApiRoutePrefix;
}

/** Full API root: base URL + route prefix (no trailing slash). */
export function getApiRoot(): string {
  return `${getApiBaseUrl()}${getApiRoutePrefix()}`;
}

export function getEnvApiBaseUrl(): string {
  return envApiBaseUrl;
}

export function getEnvApiRoutePrefix(): string {
  return envApiRoutePrefix;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

/** Network blips / offline — hide from the main UI chrome. */
export function isTransientApiError(message: string): boolean {
  return /cannot reach|can't reach|unavailable|timed out|failed to fetch|network|arrab api timed out|check your connection|unexpected error/i.test(
    message,
  );
}

export function isLocalApiBase(url: string): boolean {
  return /127\.0\.0\.1|localhost/i.test(url);
}

export function unreachableMessage(kind: "timeout" | "network", detail?: string): string {
  const root = getApiRoot();
  if (isLocalApiBase(root)) {
    if (kind === "timeout") {
      return `Arrab API timed out at ${root} — is pnpm dev:api running?`;
    }
    return detail
      ? `Cannot reach the Arrab API at ${root}: ${detail}`
      : `Cannot reach the Arrab API at ${root} — start it with pnpm dev:api`;
  }
  return kind === "timeout"
    ? "Arrab timed out. Check your connection and try again."
    : "Can't reach Arrab right now. Check your connection and try again.";
}

export function buildAuthHeaders(): Record<string, string> {
  const authHeaders: Record<string, string> = {};
  try {
    const accountToken = readAccountSessionToken();
    if (accountToken) {
      authHeaders.Authorization = `Bearer ${accountToken}`;
      authHeaders["X-Arrab-Account-Session"] = accountToken;
    }
  } catch {
    // ignore storage failures
  }
  try {
    const raw = localStorage.getItem("arrab.org.employee.session");
    if (raw) {
      const parsed = JSON.parse(raw) as { sessionToken?: string };
      if (parsed.sessionToken) {
        authHeaders["X-Arrab-Employee-Session"] = parsed.sessionToken;
      }
    }
  } catch {
    // ignore
  }
  try {
    const familyMemberId = localStorage.getItem("arrab.family.activeMemberId");
    if (familyMemberId?.trim()) {
      authHeaders["X-Arrab-Family-Member"] = familyMemberId.trim();
    }
  } catch {
    // ignore
  }
  return authHeaders;
}

export function parseErrorPayload(raw: string, status: number): ApiRequestError {
  let message = `Arrab API returned ${status}`;
  let code: string | null = null;
  try {
    const payload = JSON.parse(raw) as {
      error?: { message?: string; code?: string } | string;
      message?: string;
      code?: string;
    };
    if (typeof payload.error === "object" && payload.error) {
      if (payload.error.message) message = payload.error.message;
      if (payload.error.code) code = payload.error.code;
    } else if (typeof payload.error === "string") {
      message = payload.error;
    } else if (payload.message) {
      message = payload.message;
    }
    if (!code && typeof payload.code === "string") code = payload.code;
  } catch {
    // keep status message
  }
  if (!code && status === 402) {
    code = /session budget/i.test(message) ? "SESSION_BUDGET_EXCEEDED" : "QUOTA_EXCEEDED";
  }
  return new ApiRequestError(message, status, code);
}

export async function nativeRequest(
  url: string,
  init?: { method?: string; body?: unknown; timeoutMs?: number },
): Promise<{ status: number; body: string }> {
  return invoke<{ status: number; body: string }>("native_http_request", {
    args: {
      method: init?.method ?? "GET",
      url,
      timeoutMs: init?.timeoutMs ?? 25_000,
      headers: {
        Accept: "application/json",
        ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...buildAuthHeaders(),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    },
  });
}

export type NativeStreamEvent = { kind: "open" | "chunk" | "end" | "error"; text?: string | null; status?: number | null };

let nativeStreamSeq = 0;

/**
 * POST a streaming request (SSE) and yield decoded text as it arrives. Desktop
 * goes through native HTTP (WebView fetch is blocked by CORP:same-site).
 */
export async function* openTextStream(
  url: string,
  body: unknown,
  signal: AbortSignal,
  timeoutMs: number,
): AsyncGenerator<string> {
  const headers = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    ...buildAuthHeaders(),
  };
  if (!isTauriRuntime()) {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      throw new ApiRequestError(text || `Stream failed (${response.status})`, response.status);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      yield decoder.decode(value, { stream: true });
    }
  }

  const { Channel } = await import("@tauri-apps/api/core");
  const id = ++nativeStreamSeq;
  const queue: NativeStreamEvent[] = [];
  let wake: (() => void) | null = null;
  const push = (event: NativeStreamEvent) => {
    queue.push(event);
    wake?.();
    wake = null;
  };
  const channel = new Channel<NativeStreamEvent>();
  channel.onmessage = push;
  const onAbort = () => push({ kind: "error", text: "aborted", status: 0 });
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    await invoke("native_http_stream", {
      id,
      args: { method: "POST", url, headers, body: JSON.stringify(body), timeoutMs },
      onEvent: channel,
    });
    while (true) {
      if (queue.length === 0) await new Promise<void>((resolve) => (wake = resolve));
      const event = queue.shift()!;
      signal.throwIfAborted();
      if (event.kind === "chunk" && event.text) yield event.text;
      else if (event.kind === "end") return;
      else if (event.kind === "error") {
        // HTTP errors are final; transport errors stay plain so callers can retry.
        throw event.status
          ? parseErrorPayload(event.text ?? "", event.status)
          : new Error(event.text || unreachableMessage("network"));
      }
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    void invoke("native_http_stream_cancel", { id }).catch(() => undefined);
  }
}

/** Session headers for streams the managed client opens itself (never ERP or provider keys). */
export function sessionHeaders(): Record<string, string> {
  return buildAuthHeaders();
}

/** Plain HTTP is only allowed against a local dev API. */
export function isSecureApiRoot(root: string = getApiRoot()): boolean {
  return root.startsWith("https://") || isLocalApiBase(root);
}

/**
 * Managed-client background calls: one attempt, raw status + body, no retries
 * and no error for non-2xx. Only network failures reject; callers stay silent.
 */
export async function clientRequest(
  path: string,
  init?: { method?: string; body?: unknown; timeoutMs?: number },
): Promise<{ status: number; body: string }> {
  const root = getApiRoot();
  if (!isSecureApiRoot(root)) {
    throw new ApiRequestError("Managed client requires HTTPS", 0);
  }
  const url = `${root}${path}`;
  const timeoutMs = init?.timeoutMs ?? 15_000;
  if (isTauriRuntime()) {
    return nativeRequest(url, { method: init?.method, body: init?.body, timeoutMs });
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: init?.method ?? "GET",
      signal: controller.signal,
      redirect: "error",
      headers: {
        Accept: "application/json",
        ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...buildAuthHeaders(),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    return { status: response.status, body: await response.text() };
  } finally {
    window.clearTimeout(timer);
  }
}

export async function request<T>(
  path: string,
  init?: { method?: string; body?: unknown; timeoutMs?: number; signal?: AbortSignal },
): Promise<T> {
  const root = getApiRoot();
  const timeoutMs = init?.timeoutMs ?? (isLocalApiBase(root) ? 15_000 : 25_000);
  const url = `${root}${path}`;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    init?.signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort(init?.signal?.reason);
    init?.signal?.addEventListener("abort", abort, { once: true });
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      // Desktop WebView is blocked by Coolify CORP:same-site — use native HTTP.
      if (isTauriRuntime()) {
        const native = await nativeRequest(url, {
          method: init?.method,
          body: init?.body,
          timeoutMs,
        });
        if (native.status < 200 || native.status >= 300) {
          throw parseErrorPayload(native.body, native.status);
        }
        return JSON.parse(native.body) as T;
      }

      const response = await fetch(url, {
        method: init?.method ?? "GET",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...buildAuthHeaders(),
        },
        body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
      if (!response.ok) {
        const raw = await response.text();
        throw parseErrorPayload(raw, response.status);
      }
      return (await response.json()) as T;
    } catch (error) {
      // A caller cancellation is intentional: never turn it into a timeout or retry it.
      init?.signal?.throwIfAborted();
      if (error instanceof ApiRequestError) {
        throw error;
      }
      lastError = error;
      const aborted =
        (error instanceof DOMException && error.name === "AbortError") ||
        (error instanceof Error && /abort/i.test(error.message));
      // Retry once on transient network / restart races.
      if (attempt === 0 && !aborted) {
        await new Promise((resolve) => window.setTimeout(resolve, 350));
        continue;
      }
      if (aborted) {
        throw new ApiRequestError(unreachableMessage("timeout"), 0);
      }
      throw new ApiRequestError(unreachableMessage("network"), 0);
    } finally {
      window.clearTimeout(timer);
      init?.signal?.removeEventListener("abort", abort);
    }
  }

  throw new ApiRequestError(
    unreachableMessage("network", lastError instanceof Error ? lastError.message : undefined),
    0,
  );
}


