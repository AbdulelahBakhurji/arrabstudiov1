import { afterEach, describe, expect, it, vi } from "vitest";
import { AiGatewayError } from "./types.js";
import { providerFetch, readProviderJson, readStreamChunk } from "./provider-http.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const ok = (body: unknown = {}, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, ...init });

describe("providerFetch", () => {
  it("retries transient provider failures a bounded number of times", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(
        new Response("slow down", { status: 429, headers: { "retry-after": "0" } }),
      )
      .mockResolvedValueOnce(ok({ fine: true }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await providerFetch("https://p.test/x", { method: "POST" });
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("stops after the retry budget and returns the last failure", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(
        async () => new Response("down", { status: 502, headers: { "retry-after": "0" } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const response = await providerFetch("https://p.test/x", {});
    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry client errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await providerFetch("https://p.test/x", {})).status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps caller cancellation to CANCELLED and never calls the provider again", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const pending = providerFetch("https://p.test/x", {}, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED", statusCode: 499 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses to start when already cancelled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      providerFetch("https://p.test/x", {}, { signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({
      code: "CANCELLED",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("turns a deadline into PROVIDER_TIMEOUT", async () => {
    vi.stubGlobal(
      "fetch",
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "TimeoutError")),
          );
        }),
    );
    await expect(
      providerFetch("https://p.test/x", {}, { timeoutMs: 20, retry: false }),
    ).rejects.toMatchObject({
      code: "PROVIDER_TIMEOUT",
      statusCode: 504,
    });
  });

  it("reports an unreachable provider after retries", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(providerFetch("https://p.test/x", {}, { retry: false })).rejects.toMatchObject({
      code: "PROVIDER_UNREACHABLE",
      statusCode: 502,
    });
  });
});

describe("readProviderJson", () => {
  it("survives an HTML error page from a proxy", async () => {
    const body = await readProviderJson<{ error?: { message?: string } }>(
      new Response("<html><body><h1>502 Bad Gateway</h1></body></html>", { status: 502 }),
    );
    expect(body.error?.message).toContain("502 Bad Gateway");
    expect(body.error?.message).not.toContain("<");
  });

  it("treats an empty error body as an empty object", async () => {
    expect(await readProviderJson(new Response("", { status: 500 }))).toEqual({});
  });

  it("rejects a 200 whose body is not JSON", async () => {
    await expect(readProviderJson(new Response("oops", { status: 200 }))).rejects.toBeInstanceOf(
      AiGatewayError,
    );
  });
});

describe("readStreamChunk", () => {
  it("declares a silent stream stalled and cancels it", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull: () => new Promise(() => undefined),
      cancel: () => {
        cancelled = true;
      },
    });
    await expect(readStreamChunk(stream.getReader(), { idleMs: 25 })).rejects.toMatchObject({
      code: "PROVIDER_STALLED",
    });
    expect(cancelled).toBe(true);
  });

  it("aborts a read in flight when the caller cancels", async () => {
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => undefined) });
    const pending = readStreamChunk(stream.getReader(), { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("returns data that arrives in time", async () => {
    const stream = new ReadableStream<string>({
      start(controller) {
        controller.enqueue("hello");
      },
    });
    await expect(readStreamChunk(stream.getReader(), { idleMs: 1000 })).resolves.toEqual({
      done: false,
      value: "hello",
    });
  });
});

import { clientStatusForProvider } from "./provider-http.js";

describe("clientStatusForProvider", () => {
  it("never reports a provider auth failure as the user's 401/403 (that would sign the user out)", () => {
    for (const status of [401, 403, 404, 500, 502, 503, 504, 529]) expect(clientStatusForProvider(status), String(status)).toBe(502);
  });
  it("keeps rate limits and bad requests meaningful", () => {
    expect(clientStatusForProvider(429)).toBe(429);
    expect(clientStatusForProvider(408)).toBe(408);
    for (const status of [400, 413, 422]) expect(clientStatusForProvider(status)).toBe(400);
  });
});
