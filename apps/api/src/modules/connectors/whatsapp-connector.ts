/**
 * WhatsApp Business Cloud API (Meta) — connect permanent token + phone number,
 * send text, receive inbound via webhook.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { ValidationError } from "@arrab/core";

const GRAPH = "https://graph.facebook.com/v21.0";

export type WhatsAppSecret = {
  kind: "whatsapp";
  /** Permanent or long-lived system user token. */
  accessToken: string;
  phoneNumberId: string;
  wabaId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
};

export type WhatsAppInboundMessage = {
  id: string;
  connectorId: string | null;
  phoneNumberId: string;
  from: string;
  to: string | null;
  text: string;
  timestamp: string;
  rawType: string;
  receivedAt: string;
};

export type SendWhatsAppRequest = {
  to: string;
  text: string;
};

export type SendWhatsAppResponse = {
  ok: true;
  messageId: string | null;
  to: string;
};

export function parseWhatsAppSecret(raw: string): WhatsAppSecret | null {
  try {
    const parsed = JSON.parse(raw) as Partial<WhatsAppSecret>;
    if (
      parsed.kind !== "whatsapp" ||
      !parsed.accessToken ||
      !parsed.phoneNumberId ||
      !parsed.wabaId
    ) {
      return null;
    }
    return {
      kind: "whatsapp",
      accessToken: String(parsed.accessToken),
      phoneNumberId: String(parsed.phoneNumberId),
      wabaId: String(parsed.wabaId),
      displayPhoneNumber: parsed.displayPhoneNumber ? String(parsed.displayPhoneNumber) : null,
      verifiedName: parsed.verifiedName ? String(parsed.verifiedName) : null,
    };
  } catch {
    return null;
  }
}

export function buildWhatsAppSecret(input: {
  accessToken: string;
  phoneNumberId: string;
  wabaId: string;
  displayPhoneNumber?: string | null;
  verifiedName?: string | null;
}): WhatsAppSecret {
  const accessToken = input.accessToken.trim();
  const phoneNumberId = input.phoneNumberId.trim();
  const wabaId = input.wabaId.trim();
  if (!accessToken || accessToken.length < 20) {
    throw new ValidationError("WhatsApp access token is required");
  }
  if (!phoneNumberId) {
    throw new ValidationError("WhatsApp phone_number_id is required");
  }
  if (!wabaId) {
    throw new ValidationError("WhatsApp waba_id (WhatsApp Business Account id) is required");
  }
  return {
    kind: "whatsapp",
    accessToken,
    phoneNumberId,
    wabaId,
    displayPhoneNumber: input.displayPhoneNumber?.trim() || null,
    verifiedName: input.verifiedName?.trim() || null,
  };
}

async function graphGet<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(`${GRAPH}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new ValidationError(body.error?.message || `WhatsApp Graph error (${response.status})`);
  }
  return body;
}

export async function verifyWhatsAppSecret(secret: WhatsAppSecret): Promise<{
  label: string;
  scopes: string[];
  secret: WhatsAppSecret;
}> {
  const meta = await graphGet<{
    display_phone_number?: string;
    verified_name?: string;
    id?: string;
  }>(`/${secret.phoneNumberId}?fields=display_phone_number,verified_name,id`, secret.accessToken);

  const updated: WhatsAppSecret = {
    ...secret,
    displayPhoneNumber: meta.display_phone_number ?? secret.displayPhoneNumber,
    verifiedName: meta.verified_name ?? secret.verifiedName,
  };
  const label =
    updated.verifiedName && updated.displayPhoneNumber
      ? `${updated.verifiedName} · ${updated.displayPhoneNumber}`
      : updated.displayPhoneNumber || updated.phoneNumberId;

  return {
    label,
    scopes: ["whatsapp_business_messaging", "whatsapp_business_management"],
    secret: updated,
  };
}

export async function sendWhatsAppText(
  secret: WhatsAppSecret,
  input: SendWhatsAppRequest,
): Promise<SendWhatsAppResponse> {
  const to = normalizeWhatsAppTo(input.to);
  const text = input.text.trim();
  if (!to) throw new ValidationError("Recipient phone number is required (E.164 digits)");
  if (!text) throw new ValidationError("Message text is required");

  const response = await fetch(`${GRAPH}/${secret.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { preview_url: false, body: text },
    }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    messages?: Array<{ id?: string }>;
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new ValidationError(body.error?.message || `WhatsApp send failed (${response.status})`);
  }
  return {
    ok: true,
    messageId: body.messages?.[0]?.id ?? null,
    to,
  };
}

/** Strip + and spaces — Cloud API expects digits only (country code included). */
export function normalizeWhatsAppTo(raw: string): string {
  return raw.replace(/[^\d]/g, "");
}

export function verifyWhatsAppWebhookSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!appSecret.trim() || !signatureHeader?.startsWith("sha256=")) {
    return false;
  }
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const received = signatureHeader.slice("sha256=".length).trim();
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(received, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

type MetaWebhookPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        messaging_product?: string;
        metadata?: { display_phone_number?: string; phone_number_id?: string };
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
        messages?: Array<{
          from?: string;
          id?: string;
          timestamp?: string;
          type?: string;
          text?: { body?: string };
        }>;
      };
    }>;
  }>;
};

export function extractWhatsAppInbound(
  payload: unknown,
  connectorId: string | null = null,
): WhatsAppInboundMessage[] {
  const body = payload as MetaWebhookPayload;
  if (body.object !== "whatsapp_business_account" || !Array.isArray(body.entry)) {
    return [];
  }
  const out: WhatsAppInboundMessage[] = [];
  const receivedAt = new Date().toISOString();
  for (const entry of body.entry) {
    for (const change of entry.changes ?? []) {
      if (change.field && change.field !== "messages") continue;
      const value = change.value;
      if (!value?.messages?.length) continue;
      const phoneNumberId = value.metadata?.phone_number_id ?? "";
      for (const message of value.messages) {
        if (!message.from || !message.id) continue;
        const text =
          message.type === "text"
            ? message.text?.body?.trim() || ""
            : `[${message.type || "message"}]`;
        out.push({
          id: message.id,
          connectorId,
          phoneNumberId,
          from: message.from,
          to: value.metadata?.display_phone_number ?? null,
          text,
          timestamp: message.timestamp
            ? new Date(Number(message.timestamp) * 1000).toISOString()
            : receivedAt,
          rawType: message.type || "unknown",
          receivedAt,
        });
      }
    }
  }
  return out;
}
