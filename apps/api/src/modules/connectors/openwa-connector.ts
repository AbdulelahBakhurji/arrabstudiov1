/**
 * OpenWA — self-hosted WhatsApp gateway (https://github.com/rmyndharis/OpenWA).
 *
 * OpenWA session routes take a UUID path id (`ParseUUIDPipe`). Arrab keeps a
 * human session *name* (`as-…` / `arrab`) and stores the gateway UUID as `gatewayId`.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { ValidationError } from "@arrab/core";
import {
  normalizeWhatsAppTo,
  type SendWhatsAppRequest,
  type SendWhatsAppResponse,
  type WhatsAppInboundMessage,
} from "./whatsapp-connector.js";

export type OpenWaSecret = {
  kind: "openwa";
  baseUrl: string;
  apiKey: string;
  /** Session name in OpenWA (e.g. as-abc123 / arrab). Used for create + list?name=. */
  sessionId: string;
  /** OpenWA's UUID session id — required for /sessions/:id/* routes. */
  gatewayId?: string;
  webhookSecret: string | null;
  /** Companion that drafts WhatsApp replies for this linked phone. */
  replyCompanionId?: string;
  replyCompanionName?: string;
};

export type OpenWaWebhookPayload = {
  event?: string;
  sessionId?: string;
  idempotencyKey?: string;
  data?: {
    id?: string;
    from?: string;
    to?: string;
    body?: string;
    type?: string;
    timestamp?: number;
    fromMe?: boolean;
    isGroup?: boolean;
    senderPhone?: string;
    chatId?: string;
  };
};

type OpenWaSessionDto = {
  id?: string;
  name?: string;
  status?: string;
  phone?: string | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function trimBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

export function isOpenWaGatewayId(value: string | null | undefined): boolean {
  return Boolean(value && UUID_RE.test(value.trim()));
}

/** Path id for OpenWA /sessions/:sessionId/* — must be the gateway UUID. */
export function openWaPathId(secret: OpenWaSecret): string {
  const gateway = secret.gatewayId?.trim();
  if (gateway && isOpenWaGatewayId(gateway)) return gateway;
  if (isOpenWaGatewayId(secret.sessionId)) return secret.sessionId.trim();
  throw new ValidationError(
    "OpenWA session is not ready (missing gateway session id). Tap Connect WhatsApp again.",
  );
}

export function parseOpenWaSecret(raw: string): OpenWaSecret | null {
  try {
    const parsed = JSON.parse(raw) as Partial<OpenWaSecret>;
    if (parsed.kind !== "openwa" || !parsed.apiKey || !parsed.sessionId) return null;
    const baseUrl = trimBaseUrl(String(parsed.baseUrl || "http://127.0.0.1:2785"));
    return {
      kind: "openwa",
      baseUrl,
      apiKey: String(parsed.apiKey),
      sessionId: String(parsed.sessionId).trim(),
      ...(parsed.gatewayId ? { gatewayId: String(parsed.gatewayId) } : {}),
      webhookSecret: parsed.webhookSecret ? String(parsed.webhookSecret) : null,
      ...(parsed.replyCompanionId ? { replyCompanionId: String(parsed.replyCompanionId) } : {}),
      ...(parsed.replyCompanionName ? { replyCompanionName: String(parsed.replyCompanionName) } : {}),
    };
  } catch {
    return null;
  }
}

export function openWaSessionName(workspaceId: string, seatId: string | null): string {
  const raw = `${workspaceId}:${seatId ?? "owner"}`;
  return `as-${createHash("sha256").update(raw).digest("hex").slice(0, 18)}`;
}

/** OpenWA returns the QR as a data URL; accept bare base64 too so <img> always renders. */
export function normalizeOpenWaQr(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (value.startsWith("data:") || value.startsWith("http")) return value;
  if (/^[A-Za-z0-9+/=\s]+$/.test(value) && value.length > 200) {
    return `data:image/png;base64,${value.replace(/\s+/g, "")}`;
  }
  return null;
}

export type OpenWaSessionView = {
  status: string;
  phone: string | null;
  qrCode: string | null;
};

export function buildOpenWaSecret(input: {
  baseUrl: string;
  apiKey: string;
  sessionId: string;
  gatewayId?: string | null;
  webhookSecret?: string | null;
  replyCompanionId?: string;
  replyCompanionName?: string;
}): OpenWaSecret {
  const baseUrl = trimBaseUrl(input.baseUrl);
  const apiKey = input.apiKey.trim();
  const sessionId = input.sessionId.trim();
  if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
    throw new ValidationError("OpenWA base URL must start with http:// or https://");
  }
  if (apiKey.length < 8) throw new ValidationError("OpenWA API key is required");
  if (!/^[a-zA-Z0-9-]{3,50}$/.test(sessionId)) {
    throw new ValidationError("OpenWA session id must be 3–50 letters, numbers, or hyphens");
  }
  const webhookSecret = input.webhookSecret?.trim() || null;
  if (webhookSecret && webhookSecret.length < 16) {
    throw new ValidationError("OpenWA webhook secret must be at least 16 characters");
  }
  const gatewayId = input.gatewayId?.trim();
  return {
    kind: "openwa",
    baseUrl,
    apiKey,
    sessionId,
    ...(gatewayId && isOpenWaGatewayId(gatewayId) ? { gatewayId } : {}),
    webhookSecret,
    ...(input.replyCompanionId ? { replyCompanionId: input.replyCompanionId.slice(0, 80) } : {}),
    ...(input.replyCompanionName
      ? { replyCompanionName: input.replyCompanionName.slice(0, 80) }
      : {}),
  };
}

async function openWaFetch<T>(
  secret: OpenWaSecret,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${secret.baseUrl}/api${path.startsWith("/") ? path : `/${path}`}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      "X-API-Key": secret.apiKey,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => ({}))) as T & {
    message?: string | string[];
    statusCode?: number;
  };
  if (!response.ok) {
    const message = Array.isArray(body.message)
      ? body.message.join("; ")
      : body.message || `OpenWA error (${response.status})`;
    throw new ValidationError(message);
  }
  return body;
}

const STOPPED_STATUSES = new Set(["created", "stopped", "disconnected", "failed", "logged_out", "error"]);

function withGatewayId(secret: OpenWaSecret, session: OpenWaSessionDto): OpenWaSecret {
  const id = session.id?.trim();
  if (id && isOpenWaGatewayId(id)) {
    return { ...secret, gatewayId: id };
  }
  return secret;
}

async function findOpenWaSessionByName(secret: OpenWaSecret): Promise<OpenWaSessionDto | null> {
  const listed = await openWaFetch<OpenWaSessionDto[]>(
    secret,
    `/sessions?name=${encodeURIComponent(secret.sessionId)}`,
  ).catch(() => [] as OpenWaSessionDto[]);
  return listed[0] ?? null;
}

/** Resolve (or create) the OpenWA session and attach `gatewayId` (UUID). */
export async function resolveOpenWaSession(secret: OpenWaSecret): Promise<{
  session: OpenWaSessionDto;
  secret: OpenWaSecret;
}> {
  if (secret.gatewayId && isOpenWaGatewayId(secret.gatewayId)) {
    try {
      const session = await openWaFetch<OpenWaSessionDto>(
        secret,
        `/sessions/${encodeURIComponent(secret.gatewayId)}`,
      );
      return { session, secret: withGatewayId(secret, session) };
    } catch {
      /* gateway id stale — fall through to name lookup */
    }
  }

  let session = await findOpenWaSessionByName(secret);
  if (!session) {
    try {
      session = await openWaFetch<OpenWaSessionDto>(secret, "/sessions", {
        method: "POST",
        body: JSON.stringify({ name: secret.sessionId }),
      });
    } catch {
      // 409 name already exists (race) — list again
      session = await findOpenWaSessionByName(secret);
    }
  }
  if (!session?.id || !isOpenWaGatewayId(session.id)) {
    throw new ValidationError("OpenWA could not create or find a session for this workspace");
  }
  return { session, secret: withGatewayId(secret, session) };
}

async function startOpenWaSession(secret: OpenWaSecret): Promise<void> {
  const pathId = openWaPathId(secret);
  await openWaFetch(secret, `/sessions/${encodeURIComponent(pathId)}/start`, {
    method: "POST",
    body: JSON.stringify({}),
  }).catch(() => undefined);
}

export async function verifyOpenWaSecret(secret: OpenWaSecret): Promise<{
  label: string;
  scopes: string[];
  secret: OpenWaSecret;
}> {
  await openWaFetch<{ status?: string }>(secret, "/health");
  const resolved = await resolveOpenWaSession(secret);
  const status = (resolved.session.status ?? "created").toLowerCase();
  if (STOPPED_STATUSES.has(status)) {
    await startOpenWaSession(resolved.secret);
  }
  const phone = resolved.session.phone?.trim();
  const label = phone ? `WhatsApp · ${phone}` : `WhatsApp · linking (${resolved.session.status ?? status})`;
  return {
    label,
    scopes: ["openwa_messaging"],
    secret: resolved.secret,
  };
}

export function openWaChatId(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes("@")) return trimmed;
  const digits = normalizeWhatsAppTo(trimmed);
  if (!digits) throw new ValidationError("Recipient phone number is required (E.164 digits)");
  return `${digits}@c.us`;
}

export async function sendOpenWaText(
  secret: OpenWaSecret,
  input: SendWhatsAppRequest,
): Promise<SendWhatsAppResponse> {
  const text = input.text.trim();
  if (!text) throw new ValidationError("Message text is required");
  const chatId = openWaChatId(input.to);
  const resolved = secret.gatewayId && isOpenWaGatewayId(secret.gatewayId)
    ? { secret }
    : await resolveOpenWaSession(secret);
  const pathId = openWaPathId(resolved.secret);
  const result = await openWaFetch<{ messageId?: string }>(
    resolved.secret,
    `/sessions/${encodeURIComponent(pathId)}/messages/send-text`,
    {
      method: "POST",
      body: JSON.stringify({ chatId, text }),
    },
  );
  return {
    ok: true,
    messageId: result.messageId ?? null,
    to: normalizeWhatsAppTo(input.to),
  };
}

export function verifyOpenWaWebhookSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!secret.trim()) return true;
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
  try {
    const a = Buffer.from(signatureHeader);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function extractOpenWaInbound(
  payload: unknown,
  connectorId: string | null = null,
): WhatsAppInboundMessage[] {
  const body = payload as OpenWaWebhookPayload;
  if (body.event !== "message.received" || !body.data) return [];
  const data = body.data;
  if (data.fromMe) return [];
  const fromRaw = data.senderPhone || data.from || data.chatId || "";
  const from = normalizeWhatsAppTo(fromRaw.replace(/@.+$/, ""));
  if (!from) return [];
  const text =
    data.type === "text" || !data.type
      ? (data.body?.trim() || "")
      : `[${data.type}]${data.body?.trim() ? `: ${data.body.trim()}` : ""}`;
  if (!text) return [];
  const receivedAt = new Date().toISOString();
  const timestamp =
    typeof data.timestamp === "number"
      ? new Date(data.timestamp * 1000).toISOString()
      : receivedAt;
  return [
    {
      id: body.idempotencyKey || data.id || `openwa-${from}-${timestamp}`,
      connectorId,
      phoneNumberId: body.sessionId || "openwa",
      from,
      to: data.to ? normalizeWhatsAppTo(String(data.to).replace(/@.+$/, "")) : null,
      text,
      timestamp,
      rawType: data.type || "text",
      receivedAt,
    },
  ];
}

export async function fetchOpenWaSessionView(secret: OpenWaSecret): Promise<OpenWaSessionView> {
  const resolved = await resolveOpenWaSession(secret);
  const pathId = openWaPathId(resolved.secret);
  let status = (resolved.session.status ?? "unknown").toLowerCase();
  const phone = resolved.session.phone?.trim() || null;
  const linked = Boolean(phone) || status === "connected" || status === "authenticated";
  let qrCode: string | null = null;
  if (!linked) {
    // A stopped session never produces a QR — kick it so the user can scan.
    if (STOPPED_STATUSES.has(status)) {
      await startOpenWaSession(resolved.secret);
      status = "starting";
    }
    try {
      const qr = await openWaFetch<{ qrCode?: string; qr?: string }>(
        resolved.secret,
        `/sessions/${encodeURIComponent(pathId)}/qr`,
      );
      qrCode = normalizeOpenWaQr(qr.qrCode ?? qr.qr);
    } catch {
      qrCode = null;
    }
  }
  return { status, phone, qrCode };
}

export async function ensureOpenWaWebhook(
  secret: OpenWaSecret,
  webhookUrl: string,
): Promise<OpenWaSecret> {
  if (!secret.webhookSecret) return secret;
  const resolved = await resolveOpenWaSession(secret);
  const pathId = openWaPathId(resolved.secret);
  const existing = await openWaFetch<
    Array<{ id: string; url: string; active?: boolean }>
  >(resolved.secret, `/sessions/${encodeURIComponent(pathId)}/webhooks`).catch(() => []);
  const normalized = webhookUrl.trim();
  if (existing.some((item) => item.url === normalized && item.active !== false)) {
    return resolved.secret;
  }
  await openWaFetch(resolved.secret, `/sessions/${encodeURIComponent(pathId)}/webhooks`, {
    method: "POST",
    body: JSON.stringify({
      url: normalized,
      events: ["message.received"],
      secret: resolved.secret.webhookSecret,
      retryCount: 3,
    }),
  });
  return resolved.secret;
}

/** Unlink the phone and drop the gateway session (best effort — never blocks sign-out). */
export async function logoutOpenWaSession(secret: OpenWaSecret): Promise<void> {
  let pathId: string;
  try {
    const resolved = await resolveOpenWaSession(secret);
    pathId = openWaPathId(resolved.secret);
  } catch {
    return;
  }
  await openWaFetch(secret, `/sessions/${encodeURIComponent(pathId)}/logout`, {
    method: "POST",
    body: "{}",
  }).catch(() => undefined);
  await openWaFetch(secret, `/sessions/${encodeURIComponent(pathId)}`, { method: "DELETE" }).catch(
    () => undefined,
  );
}
