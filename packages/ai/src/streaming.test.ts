import { afterEach, describe, expect, it, vi } from "vitest";
import { BedrockConverseAdapter } from "./bedrock-converse.js";
import { ThinkTagSplitter, stripThinkBlock } from "./think-tags.js";
import type { AiStreamChunk } from "./types.js";

function run(chunks: string[]) {
  const splitter = new ThinkTagSplitter();
  const parts = [...chunks.flatMap((chunk) => splitter.push(chunk)), ...splitter.flush()];
  return {
    thinking: parts.filter((p) => p.type === "thinking").map((p) => p.text).join(""),
    answer: parts.filter((p) => p.type === "token").map((p) => p.text).join(""),
  };
}

describe("ThinkTagSplitter", () => {
  it("separates reasoning split across chunk boundaries", () => {
    expect(run(["<thi", "nk>plan the", " reply</th", "ink>\n\nHello", " there"])).toEqual({
      thinking: "plan the reply",
      answer: "Hello there",
    });
  });

  it("leaves answers that only mention the tag untouched", () => {
    expect(run(["Use a ", "<think> tag for this"])).toEqual({
      thinking: "",
      answer: "Use a <think> tag for this",
    });
  });

  it("strips a leading block from complete answers", () => {
    expect(stripThinkBlock("<think>hmm</think>\nDone")).toEqual({ answer: "Done", thinking: "hmm" });
  });
});

function frame(eventType: string, payload: unknown): Uint8Array {
  const encoder = new TextEncoder();
  const headers: number[] = [];
  const addHeader = (name: string, value: string) => {
    const n = encoder.encode(name);
    const v = encoder.encode(value);
    headers.push(n.length, ...n, 7, v.length >> 8, v.length & 0xff, ...v);
  };
  addHeader(":event-type", eventType);
  addHeader(":message-type", "event");
  const body = encoder.encode(JSON.stringify(payload));
  const total = 12 + headers.length + body.length + 4;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, total);
  view.setUint32(4, headers.length);
  out.set(headers, 12);
  out.set(body, 12 + headers.length);
  return out;
}

describe("BedrockConverseAdapter.streamComplete", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("streams text, reasoning and tool calls from converse-stream", async () => {
    const frames = [
      frame("contentBlockDelta", { contentBlockIndex: 0, delta: { reasoningContent: { text: "thinking…" } } }),
      frame("contentBlockDelta", { contentBlockIndex: 1, delta: { text: "Hel" } }),
      frame("contentBlockDelta", { contentBlockIndex: 1, delta: { text: "lo" } }),
      frame("contentBlockStart", { contentBlockIndex: 2, start: { toolUse: { toolUseId: "t1", name: "web_search" } } }),
      frame("contentBlockDelta", { contentBlockIndex: 2, delta: { toolUse: { input: '{"q":"x"}' } } }),
      frame("messageStop", { stopReason: "tool_use" }),
      frame("metadata", { usage: { inputTokens: 5, outputTokens: 7 } }),
    ];
    const bytes = new Uint8Array(frames.reduce((n, f) => n + f.length, 0));
    let at = 0;
    for (const f of frames) {
      bytes.set(f, at);
      at += f.length;
    }
    // Deliver in awkward slices so frames straddle reads.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 37) controller.enqueue(bytes.slice(i, i + 37));
        controller.close();
      },
    });
    const fetchMock = vi.fn(async () => new Response(stream, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new BedrockConverseAdapter({ apiKey: "k", region: "us-east-1" });
    const chunks: AiStreamChunk[] = [];
    for await (const chunk of adapter.streamComplete({
      model: { provider: "bedrock", model: "amazon.nova-lite-v1:0" },
      messages: [{ role: "user", content: "hi" }],
    })) {
      chunks.push(chunk);
    }

    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/converse-stream$/);
    expect(chunks.filter((c) => c.type === "thinking")).toEqual([{ type: "thinking", text: "thinking…" }]);
    expect(chunks.filter((c) => c.type === "token").map((c) => (c as { text: string }).text)).toEqual([
      "Hel",
      "lo",
    ]);
    const done = chunks.at(-1);
    expect(done?.type).toBe("done");
    if (done?.type !== "done") return;
    expect(done.completion.message.content).toBe("Hello");
    expect(done.completion.toolCalls).toEqual([{ id: "t1", name: "web_search", arguments: '{"q":"x"}' }]);
    expect(done.completion.usage).toEqual({ inputTokens: 5, outputTokens: 7 });
  });
});
