import { ValidationError } from "@arrab/core";
import type {
  ArrangeEmailRequest,
  ArrangeEmailResponse,
  ConnectorResource,
  EmailMessageDetail,
  EmailMessageSummary,
  SendEmailRequest,
  SendEmailResponse,
  StartGmailOAuthResponse,
} from "@arrab/shared";
import { createHash, randomBytes } from "node:crypto";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

export const GMAIL_OAUTH_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
] as const;

export type GmailOAuthSecret = {
  kind: "gmail";
  email: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  tokenType: string;
};

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
};

export function parseGmailSecret(raw: string): GmailOAuthSecret | null {
  try {
    const parsed = JSON.parse(raw) as Partial<GmailOAuthSecret>;
    if (
      parsed.kind !== "gmail" ||
      !parsed.email ||
      !parsed.accessToken ||
      !parsed.refreshToken
    ) {
      return null;
    }
    return {
      kind: "gmail",
      email: parsed.email,
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      expiresAt: Number(parsed.expiresAt) || 0,
      scopes: Array.isArray(parsed.scopes) ? parsed.scopes.map(String) : [...GMAIL_OAUTH_SCOPES],
      tokenType: parsed.tokenType || "Bearer",
    };
  } catch {
    return null;
  }
}

export function buildGmailAuthUrl(
  config: GoogleOAuthConfig,
  state: string,
): StartGmailOAuthResponse {
  if (!config.clientId.trim() || !config.clientSecret.trim()) {
    throw new ValidationError("Gmail OAuth is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)");
  }
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: GMAIL_OAUTH_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return { url: `${GOOGLE_AUTH}?${params.toString()}`, state };
}

export function newGmailOAuthState(): string {
  return randomBytes(24).toString("hex");
}

export async function exchangeGmailAuthCode(
  config: GoogleOAuthConfig,
  code: string,
): Promise<GmailOAuthSecret> {
  const token = await postToken({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
  });
  if (!token.access_token) {
    throw new ValidationError("Google did not return an access token");
  }
  if (!token.refresh_token) {
    throw new ValidationError(
      "Google did not return a refresh token. Revoke Arrab access in Google Account → Security → Third-party access, then Connect Gmail again.",
    );
  }
  const email = await fetchGoogleEmail(token.access_token);
  return {
    kind: "gmail",
    email,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + Math.max(60, Number(token.expires_in) || 3600) * 1000,
    scopes: (token.scope || GMAIL_OAUTH_SCOPES.join(" ")).split(/\s+/).filter(Boolean),
    tokenType: token.token_type || "Bearer",
  };
}

export async function refreshGmailSecret(
  config: GoogleOAuthConfig,
  secret: GmailOAuthSecret,
): Promise<GmailOAuthSecret> {
  if (secret.expiresAt > Date.now() + 60_000) {
    return secret;
  }
  const token = await postToken({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: secret.refreshToken,
    grant_type: "refresh_token",
  });
  if (!token.access_token) {
    throw new ValidationError("Failed to refresh Gmail access token — reconnect Gmail");
  }
  return {
    ...secret,
    accessToken: token.access_token,
    expiresAt: Date.now() + Math.max(60, Number(token.expires_in) || 3600) * 1000,
    tokenType: token.token_type || secret.tokenType,
    scopes: token.scope
      ? token.scope.split(/\s+/).filter(Boolean)
      : secret.scopes,
  };
}

export async function verifyGmailSecret(
  config: GoogleOAuthConfig,
  secret: GmailOAuthSecret,
): Promise<{ label: string; scopes: string[]; secret: GmailOAuthSecret }> {
  const fresh = await refreshGmailSecret(config, secret);
  const profile = await gmailFetch<{ emailAddress?: string }>(fresh, "/profile");
  const email = profile.emailAddress || fresh.email;
  return {
    label: email,
    scopes: fresh.scopes,
    secret: { ...fresh, email },
  };
}

export async function listGmailMailboxes(
  config: GoogleOAuthConfig,
  secret: GmailOAuthSecret,
): Promise<ConnectorResource[]> {
  const fresh = await refreshGmailSecret(config, secret);
  const payload = await gmailFetch<{ labels?: Array<{ id?: string; name?: string; type?: string }> }>(
    fresh,
    "/labels",
  );
  const labels = payload.labels ?? [];
  return labels
    .filter((label) => label.id && label.name)
    .map((label) => ({
      id: label.id!,
      name: label.name!,
      url: null,
      kind: label.type === "system" ? "mailbox" : "label",
    }));
}

export async function listGmailMessages(
  config: GoogleOAuthConfig,
  secret: GmailOAuthSecret,
  mailbox = "INBOX",
  limit = 30,
): Promise<EmailMessageSummary[]> {
  const fresh = await refreshGmailSecret(config, secret);
  const labelId = mailbox.trim() || "INBOX";
  const list = await gmailFetch<{ messages?: Array<{ id?: string }> }>(
    fresh,
    `/messages?maxResults=${Math.min(50, Math.max(1, limit))}&labelIds=${encodeURIComponent(labelId)}`,
  );
  const ids = (list.messages ?? []).map((item) => item.id).filter(Boolean) as string[];
  const items: EmailMessageSummary[] = [];
  for (const id of ids) {
    const meta = await gmailFetch<{
      id?: string;
      snippet?: string;
      labelIds?: string[];
      payload?: { headers?: Array<{ name?: string; value?: string }> };
      internalDate?: string;
    }>(fresh, `/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
    const headers = meta.payload?.headers ?? [];
    items.push({
      id: meta.id || id,
      subject: headerValue(headers, "Subject") || "(no subject)",
      from: headerValue(headers, "From") || "",
      date: headerValue(headers, "Date") || (meta.internalDate ? new Date(Number(meta.internalDate)).toISOString() : null),
      seen: !(meta.labelIds ?? []).includes("UNREAD"),
      snippet: meta.snippet || null,
    });
  }
  return items;
}

export async function readGmailMessage(
  config: GoogleOAuthConfig,
  secret: GmailOAuthSecret,
  messageId: string,
): Promise<EmailMessageDetail> {
  const fresh = await refreshGmailSecret(config, secret);
  const meta = await gmailFetch<{
    id?: string;
    snippet?: string;
    labelIds?: string[];
    payload?: {
      headers?: Array<{ name?: string; value?: string }>;
      body?: { data?: string };
      parts?: Array<{
        mimeType?: string;
        body?: { data?: string };
        parts?: Array<{ mimeType?: string; body?: { data?: string } }>;
      }>;
    };
    internalDate?: string;
  }>(fresh, `/messages/${encodeURIComponent(messageId)}?format=full`);
  const headers = meta.payload?.headers ?? [];
  const { text, html } = extractBodies(meta.payload);
  return {
    id: meta.id || messageId,
    subject: headerValue(headers, "Subject") || "(no subject)",
    from: headerValue(headers, "From") || "",
    to: splitAddresses(headerValue(headers, "To")),
    cc: splitAddresses(headerValue(headers, "Cc")),
    date: headerValue(headers, "Date") || (meta.internalDate ? new Date(Number(meta.internalDate)).toISOString() : null),
    seen: !(meta.labelIds ?? []).includes("UNREAD"),
    snippet: meta.snippet || null,
    text,
    html,
  };
}

export async function sendGmailMessage(
  config: GoogleOAuthConfig,
  secret: GmailOAuthSecret,
  body: SendEmailRequest,
): Promise<SendEmailResponse> {
  const fresh = await refreshGmailSecret(config, secret);
  const to = body.to.trim();
  const subject = body.subject.trim();
  const text = body.text ?? "";
  if (!to.includes("@") || !subject) {
    throw new ValidationError("to and subject are required");
  }
  const lines = [
    `From: ${fresh.email}`,
    `To: ${to}`,
    body.cc?.trim() ? `Cc: ${body.cc.trim()}` : null,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    body.html?.trim()
      ? "Content-Type: text/html; charset=utf-8"
      : "Content-Type: text/plain; charset=utf-8",
    "",
    body.html?.trim() || text,
  ].filter((line) => line !== null);
  const raw = Buffer.from(lines.join("\r\n"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  const sent = await gmailFetch<{ id?: string }>(fresh, "/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw }),
  });
  return {
    messageId: sent.id ?? null,
    accepted: [to],
  };
}

export async function arrangeGmailMessages(
  config: GoogleOAuthConfig,
  secret: GmailOAuthSecret,
  input: ArrangeEmailRequest,
): Promise<ArrangeEmailResponse> {
  const fresh = await refreshGmailSecret(config, secret);
  const ids = (input.messageIds ?? []).map((id: string) => id.trim()).filter(Boolean);
  if (ids.length === 0) {
    throw new ValidationError("messageIds is required");
  }
  const action = input.action;
  let modified = 0;
  for (const id of ids) {
    if (action === "trash") {
      await gmailFetch(fresh, `/messages/${encodeURIComponent(id)}/trash`, { method: "POST", body: "{}" });
      modified += 1;
      continue;
    }
    if (action === "untrash") {
      await gmailFetch(fresh, `/messages/${encodeURIComponent(id)}/untrash`, { method: "POST", body: "{}" });
      modified += 1;
      continue;
    }

    const addLabelIds: string[] = [...(input.addLabelIds ?? [])];
    const removeLabelIds: string[] = [...(input.removeLabelIds ?? [])];
    if (action === "archive") removeLabelIds.push("INBOX");
    if (action === "mark_read") removeLabelIds.push("UNREAD");
    if (action === "mark_unread") addLabelIds.push("UNREAD");
    if (action === "star") addLabelIds.push("STARRED");
    if (action === "unstar") removeLabelIds.push("STARRED");
    if (action === "move") {
      const target = (input.targetMailbox || "").trim();
      if (!target) throw new ValidationError("targetMailbox is required for move");
      removeLabelIds.push(input.mailbox?.trim() || "INBOX");
      addLabelIds.push(target);
    }
    if (action === "label" && addLabelIds.length === 0 && removeLabelIds.length === 0) {
      throw new ValidationError("label action requires addLabelIds or removeLabelIds");
    }
    if (addLabelIds.length === 0 && removeLabelIds.length === 0) {
      throw new ValidationError(`Unsupported arrange action: ${action}`);
    }
    await gmailFetch(fresh, `/messages/${encodeURIComponent(id)}/modify`, {
      method: "POST",
      body: JSON.stringify({
        addLabelIds: unique(addLabelIds),
        removeLabelIds: unique(removeLabelIds),
      }),
    });
    modified += 1;
  }
  return { ok: true, modified };
}

/** Stable fingerprint for pending OAuth sessions (not a secret). */
export function gmailStateFingerprint(state: string): string {
  return createHash("sha256").update(state).digest("hex").slice(0, 16);
}

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const payload = (await response.json()) as TokenResponse & { error?: string; error_description?: string };
  if (!response.ok) {
    throw new ValidationError(
      payload.error_description || payload.error || "Google token exchange failed",
    );
  }
  return payload;
}

async function fetchGoogleEmail(accessToken: string): Promise<string> {
  const response = await fetch(GOOGLE_USERINFO, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new ValidationError("Could not read Google account email");
  }
  const payload = (await response.json()) as { email?: string };
  if (!payload.email?.includes("@")) {
    throw new ValidationError("Google account has no email");
  }
  return payload.email;
}

async function gmailFetch<T>(
  secret: GmailOAuthSecret,
  path: string,
  init?: { method?: string; body?: string },
): Promise<T> {
  const response = await fetch(`${GMAIL_API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${secret.accessToken}`,
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new ValidationError(`Gmail API error (${response.status}): ${text.slice(0, 240)}`);
  }
  if (response.status === 204) {
    return {} as T;
  }
  return (await response.json()) as T;
}

function headerValue(
  headers: Array<{ name?: string; value?: string }>,
  name: string,
): string {
  const found = headers.find((header) => header.name?.toLowerCase() === name.toLowerCase());
  return found?.value?.trim() || "";
}

function splitAddresses(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function decodeBody(data?: string): string {
  if (!data) return "";
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function extractBodies(payload: {
  body?: { data?: string };
  parts?: Array<{
    mimeType?: string;
    body?: { data?: string };
    parts?: Array<{ mimeType?: string; body?: { data?: string } }>;
  }>;
} | undefined): { text: string | null; html: string | null } {
  if (!payload) return { text: null, html: null };
  let text: string | null = null;
  let html: string | null = null;
  const visit = (part: {
    mimeType?: string;
    body?: { data?: string };
    parts?: Array<{ mimeType?: string; body?: { data?: string }; parts?: unknown[] }>;
  }) => {
    const mime = (part.mimeType || "").toLowerCase();
    const decoded = decodeBody(part.body?.data);
    if (mime === "text/plain" && decoded && !text) text = decoded;
    if (mime === "text/html" && decoded && !html) html = decoded;
    for (const child of part.parts ?? []) {
      visit(child as typeof part);
    }
  };
  visit(payload);
  if (!text && !html && payload.body?.data) {
    text = decodeBody(payload.body.data);
  }
  return { text, html };
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
