import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractOpenWaInbound,
  isOpenWaGatewayId,
  normalizeOpenWaQr,
  openWaChatId,
  openWaPathId,
  openWaSessionName,
  resolveOpenWaSession,
  verifyOpenWaWebhookSignature,
  type OpenWaSecret,
} from "./openwa-connector.js";

const GATEWAY_UUID = "11111111-2222-4333-a444-555555555555";

function baseSecret(overrides: Partial<OpenWaSecret> = {}): OpenWaSecret {
  return {
    kind: "openwa",
    baseUrl: "http://127.0.0.1:2785",
    apiKey: "test-api-key-long",
    sessionId: "as-abcdef0123456789ab",
    webhookSecret: "sixteen-char-secret",
    ...overrides,
  };
}

describe("openwa-connector", () => {
  it("derives stable per-seat session names", () => {
    const a = openWaSessionName("ws-1", "seat-a");
    const b = openWaSessionName("ws-1", "seat-b");
    expect(a).toMatch(/^as-[a-f0-9]{18}$/);
    expect(a).not.toBe(b);
    expect(openWaSessionName("ws-1", null)).toMatch(/^as-/);
  });

  it("formats chat ids for send-text", () => {
    expect(openWaChatId("966501234567")).toBe("966501234567@c.us");
    expect(openWaChatId("966501234567@c.us")).toBe("966501234567@c.us");
  });

  it("requires a UUID gateway id for session path routes", () => {
    expect(isOpenWaGatewayId(GATEWAY_UUID)).toBe(true);
    expect(isOpenWaGatewayId("as-abcdef0123456789ab")).toBe(false);
    expect(openWaPathId(baseSecret({ gatewayId: GATEWAY_UUID }))).toBe(GATEWAY_UUID);
    expect(() => openWaPathId(baseSecret())).toThrow(/missing gateway session id/i);
  });

  it("extracts inbound text from message.received webhooks", () => {
    const items = extractOpenWaInbound(
      {
        event: "message.received",
        sessionId: GATEWAY_UUID,
        idempotencyKey: "msg-1",
        data: {
          from: "966501234567@c.us",
          body: "Salam",
          type: "text",
          timestamp: 1_700_000_000,
          fromMe: false,
        },
      },
      "conn-1",
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.from).toBe("966501234567");
    expect(items[0]?.text).toBe("Salam");
    expect(items[0]?.connectorId).toBe("conn-1");
  });

  it("verifies OpenWA HMAC signatures", () => {
    const raw = '{"event":"message.received"}';
    const secret = "sixteen-char-secret";
    const sig = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
    expect(verifyOpenWaWebhookSignature(raw, sig, secret)).toBe(true);
    expect(verifyOpenWaWebhookSignature(raw, "sha256=deadbeef", secret)).toBe(false);
  });
});

describe("openwa QR", () => {
  it("keeps data URLs and wraps bare base64 so the QR image renders", () => {
    expect(normalizeOpenWaQr("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    expect(normalizeOpenWaQr("A".repeat(300))).toBe(`data:image/png;base64,${"A".repeat(300)}`);
    expect(normalizeOpenWaQr("2@rawwhatsappqrstring,xx")).toBeNull();
    expect(normalizeOpenWaQr(null)).toBeNull();
  });
});

describe("resolveOpenWaSession", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists by name then attaches gateway UUID (never calls /sessions/:name)", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push(`${init?.method ?? "GET"} ${url}`);
        if (url.endsWith("/api/sessions?name=as-abcdef0123456789ab")) {
          return new Response(
            JSON.stringify([{ id: GATEWAY_UUID, name: "as-abcdef0123456789ab", status: "created" }]),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ message: "unexpected" }), { status: 500 });
      }),
    );

    const resolved = await resolveOpenWaSession(baseSecret());
    expect(resolved.secret.gatewayId).toBe(GATEWAY_UUID);
    expect(resolved.session.id).toBe(GATEWAY_UUID);
    expect(calls.some((c) => c.includes(`/sessions/as-`))).toBe(false);
    expect(calls.some((c) => c.includes("name=as-abcdef0123456789ab"))).toBe(true);
  });

  it("creates by name when list is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/sessions?name=")) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (url.endsWith("/api/sessions") && init?.method === "POST") {
          return new Response(
            JSON.stringify({ id: GATEWAY_UUID, name: "as-abcdef0123456789ab", status: "created" }),
            { status: 201 },
          );
        }
        return new Response(JSON.stringify({ message: "unexpected" }), { status: 500 });
      }),
    );

    const resolved = await resolveOpenWaSession(baseSecret());
    expect(resolved.secret.gatewayId).toBe(GATEWAY_UUID);
  });
});
