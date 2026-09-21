import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { arrabApi } from "../../apps/desktop/src/lib/api";

beforeEach(() => {
  vi.stubGlobal("window", { setTimeout, clearTimeout });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("caller-cancelled chat requests", () => {
  it("never starts a request whose signal is already aborted", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();
    await expect(
      arrabApi.sendMessageStream("room", { content: "hello" }, {}, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts an active stream without retrying the message or reporting an error", async () => {
    let networkSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      networkSignal = init.signal as AbortSignal;
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(stream) {
              stream.enqueue(new TextEncoder().encode('event: token\ndata: {"text":"First"}\n\n'));
              networkSignal!.addEventListener("abort", () => stream.error(networkSignal!.reason), {
                once: true,
              });
            },
          }),
          { status: 200 },
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const onError = vi.fn();
    const onDone = vi.fn();
    const onToken = vi.fn(() => controller.abort());
    await expect(
      arrabApi.sendMessageStream(
        "room",
        { content: "hello" },
        {
          onToken,
          onError,
          onDone,
        },
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(networkSignal?.aborted).toBe(true);
    expect(onToken).toHaveBeenCalledExactlyOnceWith("First");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("does not deliver buffered late tokens after a stop", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            'event: token\ndata: {"text":"first"}\n\nevent: token\ndata: {"text":"late"}\n\n',
            { status: 200 },
          ),
      ),
    );
    const controller = new AbortController();
    const onToken = vi.fn(() => controller.abort());
    await expect(
      arrabApi.sendMessageStream("room", { content: "hello" }, { onToken }, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(onToken).toHaveBeenCalledExactlyOnceWith("first");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("can cancel the non-stream fallback without starting another POST", async () => {
    const controller = new AbortController();
    let fallbackSignal: AbortSignal | undefined;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 200 }))
      .mockImplementationOnce((_url: string, init: RequestInit) => {
        fallbackSignal = init.signal as AbortSignal;
        const response = new Promise((_resolve, reject) => {
          fallbackSignal!.addEventListener("abort", () => reject(fallbackSignal!.reason), {
            once: true,
          });
        });
        controller.abort();
        return response;
      });
    vi.stubGlobal("fetch", fetchMock);
    const onError = vi.fn();
    await expect(
      arrabApi.sendMessageStream("room", { content: "hello" }, { onError }, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fallbackSignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
  });

  it("also cancels setup calls without retrying or translating the reason to a timeout", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      const signal = init.signal as AbortSignal;
      const response = new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
      controller.abort();
      return response;
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      arrabApi.createConversation({ agentId: "agent", title: "test" }, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
