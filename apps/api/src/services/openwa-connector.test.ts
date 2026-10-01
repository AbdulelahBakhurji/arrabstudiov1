import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  extractOpenWaInbound,
  openWaChatId,
  openWaSessionName,
  verifyOpenWaWebhookSignature,
} from "./openwa-connector.js";

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

  it("extracts inbound text from message.received webhooks", () => {
    const items = extractOpenWaInbound(
      {
        event: "message.received",
        sessionId: "arrab",
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
  it("keeps data URLs and wraps bare base64 so the QR image renders", async () => {
    const { normalizeOpenWaQr } = await import("./openwa-connector.js");
    expect(normalizeOpenWaQr("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    expect(normalizeOpenWaQr("A".repeat(300))).toBe(`data:image/png;base64,${"A".repeat(300)}`);
    expect(normalizeOpenWaQr("2@rawwhatsappqrstring,xx")).toBeNull();
    expect(normalizeOpenWaQr(null)).toBeNull();
  });
});
