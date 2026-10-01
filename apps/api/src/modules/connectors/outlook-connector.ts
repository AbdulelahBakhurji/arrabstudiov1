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
import { randomBytes } from "node:crypto";

const MS_AUTH = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const MS_TOKEN = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const GRAPH = "https://graph.microsoft.com/v1.0";

export const OUTLOOK_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "offline_access",
  "User.Read",
  "Mail.ReadWrite",
  "Mail.Send",
] as const;

export type OutlookOAuthSecret = {
  kind: "outlook";
  email: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  tokenType: string;
};

export type MicrosoftOAuthConfig = {
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
  error?: string;
  error_description?: string;
};

/** Same shape as Gmail start response. */
export type StartOutlookOAuthResponse = StartGmailOAuthResponse;

export function parseOutlookSecret(raw: string): OutlookOAuthSecret | null {
  try {
    const parsed = JSON.parse(raw) as Partial<OutlookOAuthSecret>;
    if (
      parsed.kind !== "outlook" ||
      !parsed.email ||
      !parsed.accessToken ||
      !parsed.refreshToken
    ) {
      return null;
    }
    return {
      kind: "outlook",
      email: parsed.email,
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      expiresAt: Number(parsed.expiresAt) || 0,
      scopes: Array.isArray(parsed.scopes) ? parsed.scopes.map(String) : [...OUTLOOK_OAUTH_SCOPES],
      tokenType: parsed.tokenType || "Bearer",
    };
  } catch {
    return null;
  }
}

export function newOutlookOAuthState(): string {
  return randomBytes(24).toString("hex");
}

export function buildOutlookAuthUrl(
  config: MicrosoftOAuthConfig,
  state: string,
): StartOutlookOAuthResponse {
  if (!config.clientId.trim() || !config.clientSecret.trim()) {
    throw new ValidationError(
      "Outlook OAuth is not configured (MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET)",
    );
  }
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    response_mode: "query",
    scope: OUTLOOK_OAUTH_SCOPES.join(" "),
    state,
    prompt: "select_account",
  });
  return { url: `${MS_AUTH}?${params.toString()}`, state };
}

export async function exchangeOutlookAuthCode(
  config: MicrosoftOAuthConfig,
  code: string,
): Promise<OutlookOAuthSecret> {
  const token = await postToken({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    code,
    grant_type: "authorization_code",
  });
  if (!token.access_token) {
    throw new ValidationError("Microsoft did not return an access token");
  }
  if (!token.refresh_token) {
    throw new ValidationError(
      "Microsoft did not return a refresh token. Ensure offline_access is granted, then Connect Outlook again.",
    );
  }
  const email = await fetchMicrosoftEmail(token.access_token);
  return {
    kind: "outlook",
    email,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + Math.max(60, Number(token.expires_in) || 3600) * 1000,
    scopes: (token.scope || OUTLOOK_OAUTH_SCOPES.join(" ")).split(/\s+/).filter(Boolean),
    tokenType: token.token_type || "Bearer",
  };
}

export async function refreshOutlookSecret(
  config: MicrosoftOAuthConfig,
  secret: OutlookOAuthSecret,
): Promise<OutlookOAuthSecret> {
  if (secret.expiresAt > Date.now() + 60_000) {
    return secret;
  }
  const token = await postToken({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: secret.refreshToken,
    grant_type: "refresh_token",
    scope: OUTLOOK_OAUTH_SCOPES.join(" "),
  });
  if (!token.access_token) {
    throw new ValidationError("Failed to refresh Outlook access token — reconnect Outlook");
  }
  return {
    ...secret,
    accessToken: token.access_token,
    refreshToken: token.refresh_token || secret.refreshToken,
    expiresAt: Date.now() + Math.max(60, Number(token.expires_in) || 3600) * 1000,
    tokenType: token.token_type || secret.tokenType,
    scopes: token.scope ? token.scope.split(/\s+/).filter(Boolean) : secret.scopes,
  };
}

export async function verifyOutlookSecret(
  config: MicrosoftOAuthConfig,
  secret: OutlookOAuthSecret,
): Promise<{ label: string; scopes: string[]; secret: OutlookOAuthSecret }> {
  const fresh = await refreshOutlookSecret(config, secret);
  const profile = await graphFetch<{ mail?: string; userPrincipalName?: string }>(fresh, "/me");
  const email = profile.mail || profile.userPrincipalName || fresh.email;
  return {
    label: email,
    scopes: fresh.scopes,
    secret: { ...fresh, email },
  };
}

export async function listOutlookMailboxes(
  config: MicrosoftOAuthConfig,
  secret: OutlookOAuthSecret,
): Promise<ConnectorResource[]> {
  const fresh = await refreshOutlookSecret(config, secret);
  const payload = await graphFetch<{
    value?: Array<{ id?: string; displayName?: string; wellKnownName?: string }>;
  }>(fresh, "/me/mailFolders?$top=50");
  return (payload.value ?? [])
    .filter((folder) => folder.id && folder.displayName)
    .map((folder) => ({
      id: folder.id!,
      name: folder.wellKnownName || folder.displayName!,
      url: null,
      kind: "mailbox",
    }));
}

export async function listOutlookMessages(
  config: MicrosoftOAuthConfig,
  secret: OutlookOAuthSecret,
  mailbox = "inbox",
  limit = 30,
): Promise<EmailMessageSummary[]> {
  const fresh = await refreshOutlookSecret(config, secret);
  const folder = mapMailbox(mailbox);
  const path =
    folder === "inbox"
      ? `/me/mailFolders/inbox/messages?$top=${Math.min(50, Math.max(1, limit))}&$select=id,subject,from,receivedDateTime,isRead,bodyPreview&$orderby=receivedDateTime desc`
      : `/me/mailFolders/${encodeURIComponent(folder)}/messages?$top=${Math.min(50, Math.max(1, limit))}&$select=id,subject,from,receivedDateTime,isRead,bodyPreview&$orderby=receivedDateTime desc`;
  const payload = await graphFetch<{
    value?: Array<{
      id?: string;
      subject?: string;
      from?: { emailAddress?: { name?: string; address?: string } };
      receivedDateTime?: string;
      isRead?: boolean;
      bodyPreview?: string;
    }>;
  }>(fresh, path);
  return (payload.value ?? []).map((item) => ({
    id: item.id || "",
    subject: item.subject || "(no subject)",
    from: formatAddress(item.from?.emailAddress),
    date: item.receivedDateTime || null,
    seen: Boolean(item.isRead),
    snippet: item.bodyPreview || null,
  }));
}

export async function readOutlookMessage(
  config: MicrosoftOAuthConfig,
  secret: OutlookOAuthSecret,
  messageId: string,
): Promise<EmailMessageDetail> {
  const fresh = await refreshOutlookSecret(config, secret);
  const item = await graphFetch<{
    id?: string;
    subject?: string;
    from?: { emailAddress?: { name?: string; address?: string } };
    toRecipients?: Array<{ emailAddress?: { name?: string; address?: string } }>;
    ccRecipients?: Array<{ emailAddress?: { name?: string; address?: string } }>;
    receivedDateTime?: string;
    isRead?: boolean;
    bodyPreview?: string;
    body?: { contentType?: string; content?: string };
  }>(
    fresh,
    `/me/messages/${encodeURIComponent(messageId)}?$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,isRead,bodyPreview,body`,
  );
  const content = item.body?.content || null;
  const isHtml = (item.body?.contentType || "").toLowerCase() === "html";
  return {
    id: item.id || messageId,
    subject: item.subject || "(no subject)",
    from: formatAddress(item.from?.emailAddress),
    to: (item.toRecipients ?? []).map((r) => formatAddress(r.emailAddress)).filter(Boolean),
    cc: (item.ccRecipients ?? []).map((r) => formatAddress(r.emailAddress)).filter(Boolean),
    date: item.receivedDateTime || null,
    seen: Boolean(item.isRead),
    snippet: item.bodyPreview || null,
    text: isHtml ? stripHtml(content || "") : content,
    html: isHtml ? content : null,
  };
}

export async function sendOutlookMessage(
  config: MicrosoftOAuthConfig,
  secret: OutlookOAuthSecret,
  body: SendEmailRequest,
): Promise<SendEmailResponse> {
  const fresh = await refreshOutlookSecret(config, secret);
  const to = body.to.trim();
  const subject = body.subject.trim();
  if (!to.includes("@") || !subject) {
    throw new ValidationError("to and subject are required");
  }
  const cc = (body.cc ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  await graphFetch(fresh, "/me/sendMail", {
    method: "POST",
    body: JSON.stringify({
      message: {
        subject,
        body: {
          contentType: body.html?.trim() ? "HTML" : "Text",
          content: body.html?.trim() || body.text || "",
        },
        toRecipients: [{ emailAddress: { address: to } }],
        ccRecipients: cc.map((address) => ({ emailAddress: { address } })),
      },
      saveToSentItems: true,
    }),
  });
  return { messageId: null, accepted: [to] };
}

export async function arrangeOutlookMessages(
  config: MicrosoftOAuthConfig,
  secret: OutlookOAuthSecret,
  input: ArrangeEmailRequest,
): Promise<ArrangeEmailResponse> {
  const fresh = await refreshOutlookSecret(config, secret);
  const ids = (input.messageIds ?? []).map((id: string) => id.trim()).filter(Boolean);
  if (ids.length === 0) {
    throw new ValidationError("messageIds is required");
  }
  const action = input.action;
  let modified = 0;
  for (const id of ids) {
    if (action === "trash") {
      await graphFetch(fresh, `/me/messages/${encodeURIComponent(id)}/move`, {
        method: "POST",
        body: JSON.stringify({ destinationId: "deleteditems" }),
      });
      modified += 1;
      continue;
    }
    if (action === "archive") {
      await graphFetch(fresh, `/me/messages/${encodeURIComponent(id)}/move`, {
        method: "POST",
        body: JSON.stringify({ destinationId: "archive" }),
      });
      modified += 1;
      continue;
    }
    if (action === "mark_read" || action === "mark_unread") {
      await graphFetch(fresh, `/me/messages/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ isRead: action === "mark_read" }),
      });
      modified += 1;
      continue;
    }
    if (action === "star" || action === "unstar") {
      await graphFetch(fresh, `/me/messages/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ flag: { flagStatus: action === "star" ? "flagged" : "notFlagged" } }),
      });
      modified += 1;
      continue;
    }
    if (action === "move") {
      const target = (input.targetMailbox || "").trim();
      if (!target) throw new ValidationError("targetMailbox is required for move");
      await graphFetch(fresh, `/me/messages/${encodeURIComponent(id)}/move`, {
        method: "POST",
        body: JSON.stringify({ destinationId: mapMailbox(target) }),
      });
      modified += 1;
      continue;
    }
    throw new ValidationError(`Unsupported Outlook arrange action: ${action}`);
  }
  return { ok: true, modified };
}

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(MS_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const payload = (await response.json()) as TokenResponse;
  if (!response.ok) {
    throw new ValidationError(payload.error_description || payload.error || "Microsoft token exchange failed");
  }
  return payload;
}

async function fetchMicrosoftEmail(accessToken: string): Promise<string> {
  const response = await fetch(`${GRAPH}/me?$select=mail,userPrincipalName`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new ValidationError("Could not read Microsoft account email");
  }
  const payload = (await response.json()) as { mail?: string; userPrincipalName?: string };
  const email = payload.mail || payload.userPrincipalName || "";
  if (!email.includes("@")) {
    throw new ValidationError("Microsoft account has no email");
  }
  return email;
}

async function graphFetch<T>(
  secret: OutlookOAuthSecret,
  path: string,
  init?: { method?: string; body?: string },
): Promise<T> {
  const response = await fetch(`${GRAPH}${path}`, {
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
    throw new ValidationError(`Outlook API error (${response.status}): ${text.slice(0, 240)}`);
  }
  if (response.status === 202 || response.status === 204) {
    return {} as T;
  }
  const text = await response.text();
  if (!text.trim()) return {} as T;
  return JSON.parse(text) as T;
}

function formatAddress(value?: { name?: string; address?: string } | null): string {
  if (!value) return "";
  if (value.name && value.address) return `${value.name} <${value.address}>`;
  return value.address || value.name || "";
}

function mapMailbox(mailbox: string): string {
  const key = mailbox.trim().toLowerCase();
  if (!key || key === "inbox") return "inbox";
  if (key === "sent" || key === "sentitems") return "sentitems";
  if (key === "drafts") return "drafts";
  if (key === "deleted" || key === "trash" || key === "deleteditems") return "deleteditems";
  if (key === "archive") return "archive";
  if (key === "junk" || key === "junkemail") return "junkemail";
  return mailbox.trim();
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
