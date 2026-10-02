import { AiGatewayError } from "./types.js";

/** Whole non-streaming completion, including a slow reasoning model. */
export const COMPLETE_TIMEOUT_MS = 180_000;
/** Streaming: time allowed until the provider answers with response headers. */
export const STREAM_CONNECT_TIMEOUT_MS = 45_000;
/** Streaming: longest silence between two chunks before the stream is declared stalled. */
export const STREAM_IDLE_TIMEOUT_MS = 90_000;
/** Largest single SSE/event line we will buffer while waiting for a newline. */
export const MAX_STREAM_LINE_BYTES = 2_000_000;

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 6_000;

export interface ProviderCallOptions {
  /** Caller cancellation (client disconnected, user pressed stop). */
  signal?: AbortSignal;
  /** Deadline for this call; defaults depend on the call kind. */
  timeoutMs?: number;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancelled());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(cancelled());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function cancelled(): AiGatewayError {
  return new AiGatewayError("CANCELLED", "The request was cancelled", 499);
}

function retryDelayMs(attempt: number, response: Response | null): number {
  const header = response?.headers.get("retry-after");
  const seconds = header ? Number(header) : Number.NaN;
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAX_RETRY_DELAY_MS, seconds * 1000);
  }
  const base = 400 * 2 ** attempt;
  return Math.min(MAX_RETRY_DELAY_MS, base + Math.floor(Math.random() * 250));
}

/**
 * `fetch` for model providers: every call gets a deadline and honours caller cancellation,
 * network failures become typed gateway errors, and transient failures (429 / 5xx / reset
 * connections) are retried a bounded number of times *before any response body is read*,
 * so a retry can never duplicate output that was already streamed to the user.
 */
export async function providerFetch(
  url: string,
  init: RequestInit,
  options: ProviderCallOptions & { retry?: boolean } = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? COMPLETE_TIMEOUT_MS;
  const retry = options.retry !== false;

  for (let attempt = 0; ; attempt += 1) {
    if (options.signal?.aborted) throw cancelled();
    const signals = [AbortSignal.timeout(timeoutMs)];
    if (options.signal) signals.push(options.signal);
    const merged = AbortSignal.any(signals);

    let response: Response | null = null;
    try {
      response = await fetch(url, { ...init, signal: merged });
    } catch (error) {
      if (options.signal?.aborted) throw cancelled();
      const timedOut = merged.aborted;
      if (!timedOut && retry && attempt < MAX_RETRIES) {
        await sleep(retryDelayMs(attempt, null), options.signal);
        continue;
      }
      throw new AiGatewayError(
        timedOut ? "PROVIDER_TIMEOUT" : "PROVIDER_UNREACHABLE",
        timedOut
          ? "The model provider did not answer in time"
          : `Could not reach the model provider${error instanceof Error && error.message ? ` (${error.message})` : ""}`,
        timedOut ? 504 : 502,
      );
    }

    if (retry && attempt < MAX_RETRIES && RETRYABLE_STATUS.has(response.status)) {
      const delay = retryDelayMs(attempt, response);
      // Free the connection before waiting.
      await response.body?.cancel().catch(() => undefined);
      await sleep(delay, options.signal);
      continue;
    }
    return response;
  }
}

/**
 * Parse a provider body as JSON without letting a non-JSON error page (HTML 502 from a
 * proxy, an empty body) turn into an opaque SyntaxError.
 */
export async function readProviderJson<T extends object>(response: Response): Promise<T> {
  const text = await response.text().catch(() => "");
  if (!text.trim()) return {} as T;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as T) : ({} as T);
  } catch {
    if (response.ok) {
      throw new AiGatewayError(
        "PROVIDER_ERROR",
        "The model provider returned a malformed response",
        502,
      );
    }
    // Non-JSON error body: surface a short, tag-free hint rather than the raw page.
    const hint = text
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
    return {
      error: { message: hint || `Provider request failed with ${response.status}` },
      message: hint,
    } as unknown as T;
  }
}

/**
 * `reader.read()` with an idle deadline and cancellation. A provider that opens a stream and
 * then goes silent would otherwise hold the request (and its quota reservation) forever.
 */
export async function readStreamChunk<T>(
  reader: ReadableStreamDefaultReader<T>,
  options: ProviderCallOptions & { idleMs?: number } = {},
): Promise<Awaited<ReturnType<ReadableStreamDefaultReader<T>["read"]>>> {
  const idleMs = options.idleMs ?? STREAM_IDLE_TIMEOUT_MS;
  if (options.signal?.aborted) {
    await reader.cancel().catch(() => undefined);
    throw cancelled();
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new AiGatewayError("PROVIDER_STALLED", "The model stopped responding mid-stream", 504),
      );
    }, idleMs);
    onAbort = () => reject(cancelled());
    options.signal?.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([reader.read(), guard]);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) options.signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * HTTP status to report to *our* client for a provider failure. A provider answering 401/403 means
 * *our* credentials or quota are wrong — not that the user's session is: passing it through would
 * make the app think the user was signed out. Those (and 404 model-not-found, 5xx) become 502;
 * 429 and genuine bad-request statuses keep their meaning.
 */
export function clientStatusForProvider(status: number): number {
  if (status === 429 || status === 408) return status;
  if (status === 400 || status === 413 || status === 422) return 400;
  return 502;
}
