import { ValidationError } from "@arrab/core";
import type { ConnectorProvider, StartGmailOAuthResponse } from "@arrab/shared";
import { randomBytes } from "node:crypto";

export type GenericOAuthProvider =
  | "gitlab"
  | "bitbucket"
  | "linear"
  | "slack"
  | "notion"
  | "whoop"
  | "fitbit"
  | "google_drive"
  | "google_calendar"
  | "figma";

export type GenericOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type GenericOAuthSecret = {
  kind: GenericOAuthProvider;
  accountLabel: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  scopes: string[];
  tokenType: string;
  raw?: Record<string, unknown>;
};

type ProviderSpec = {
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** Slack uses form body; Notion uses Basic auth on token. */
  tokenAuth: "body" | "basic";
  extraAuthorize?: Record<string, string>;
};

const SPECS: Record<GenericOAuthProvider, ProviderSpec> = {
  gitlab: {
    authorizeUrl: "https://gitlab.com/oauth/authorize",
    tokenUrl: "https://gitlab.com/oauth/token",
    scopes: ["api", "read_user", "read_repository", "write_repository"],
    tokenAuth: "body",
  },
  bitbucket: {
    authorizeUrl: "https://bitbucket.org/site/oauth2/authorize",
    tokenUrl: "https://bitbucket.org/site/oauth2/access_token",
    scopes: ["account", "repository"],
    tokenAuth: "basic",
  },
  linear: {
    authorizeUrl: "https://linear.app/oauth/authorize",
    tokenUrl: "https://api.linear.app/oauth/token",
    scopes: ["read", "write"],
    tokenAuth: "body",
    extraAuthorize: { actor: "user", prompt: "consent" },
  },
  slack: {
    authorizeUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    scopes: [
      "channels:read",
      "channels:history",
      "chat:write",
      "users:read",
      "groups:read",
      "im:read",
      "mpim:read",
    ],
    tokenAuth: "body",
  },
  notion: {
    authorizeUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    scopes: [],
    tokenAuth: "basic",
    extraAuthorize: { owner: "user" },
  },
  whoop: {
    authorizeUrl: "https://api.prod.whoop.com/oauth/oauth2/auth",
    tokenUrl: "https://api.prod.whoop.com/oauth/oauth2/token",
    scopes: [
      "read:recovery",
      "read:cycles",
      "read:workout",
      "read:sleep",
      "read:profile",
      "read:body_measurement",
      "offline",
    ],
    tokenAuth: "body",
  },
  fitbit: {
    authorizeUrl: "https://www.fitbit.com/oauth2/authorize",
    tokenUrl: "https://api.fitbit.com/oauth2/token",
    scopes: [
      "activity",
      "heartrate",
      "sleep",
      "profile",
      "weight",
      "nutrition",
      "oxygen_saturation",
      "respiratory_rate",
      "temperature",
    ],
    tokenAuth: "basic",
  },
  google_drive: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/drive.metadata.readonly",
    ],
    tokenAuth: "body",
    extraAuthorize: {
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
    },
  },
  google_calendar: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/calendar.events",
    ],
    tokenAuth: "body",
    extraAuthorize: {
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
    },
  },
  figma: {
    authorizeUrl: "https://www.figma.com/oauth",
    tokenUrl: "https://api.figma.com/v1/oauth/token",
    scopes: [
      "current_user:read",
      "file_content:read",
      "file_metadata:read",
      "file_comments:read",
    ],
    tokenAuth: "basic",
  },
};

export function isGenericOAuthProvider(value: string): value is GenericOAuthProvider {
  return value in SPECS;
}

export function newGenericOAuthState(): string {
  return randomBytes(24).toString("hex");
}

export function buildGenericAuthUrl(
  provider: GenericOAuthProvider,
  config: GenericOAuthConfig,
  state: string,
): StartGmailOAuthResponse {
  if (!config.clientId.trim() || !config.clientSecret.trim()) {
    throw new ValidationError(`${provider} OAuth is not configured on the server`);
  }
  const spec = SPECS[provider];
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    state,
    ...(spec.scopes.length > 0
      ? {
          [provider === "slack" ? "scope" : "scope"]:
            provider === "slack" ? spec.scopes.join(",") : spec.scopes.join(" "),
        }
      : {}),
    ...spec.extraAuthorize,
  });
  // Slack bot scopes use `scope`; user token would use `user_scope` — keep bot scope.
  if (provider === "slack") {
    params.set("scope", spec.scopes.join(","));
  }
  return {
    url: `${spec.authorizeUrl}?${params.toString()}`,
    state,
  };
}

export async function exchangeGenericAuthCode(
  provider: GenericOAuthProvider,
  config: GenericOAuthConfig,
  code: string,
): Promise<GenericOAuthSecret> {
  const spec = SPECS[provider];
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
  });

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
  };

  if (spec.tokenAuth === "basic") {
    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
    headers.Authorization = `Basic ${basic}`;
  } else {
    body.set("client_id", config.clientId);
    body.set("client_secret", config.clientSecret);
  }

  const tokenRes = await fetch(spec.tokenUrl, {
    method: "POST",
    headers,
    body,
  });
  const tokenJson = (await tokenRes.json()) as Record<string, unknown>;
  if (!tokenRes.ok) {
    const message =
      String(tokenJson.error_description || tokenJson.error || tokenJson.message || "") ||
      `${provider} token exchange failed`;
    throw new ValidationError(message);
  }

  if (provider === "slack") {
    if (tokenJson.ok === false) {
      throw new ValidationError(String(tokenJson.error || "Slack OAuth failed"));
    }
    const accessToken = String(
      (tokenJson.access_token as string | undefined) ||
        ((tokenJson.authed_user as { access_token?: string } | undefined)?.access_token ?? ""),
    );
    if (!accessToken) {
      throw new ValidationError("Slack OAuth did not return an access token");
    }
    const team = tokenJson.team as { name?: string; id?: string } | undefined;
    return {
      kind: "slack",
      accountLabel: team?.name || team?.id || "Slack",
      accessToken,
      refreshToken: null,
      expiresAt: 0,
      scopes: String(tokenJson.scope || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      tokenType: "bearer",
      raw: tokenJson,
    };
  }

  if (provider === "notion") {
    const accessToken = String(tokenJson.access_token || "");
    if (!accessToken) {
      throw new ValidationError("Notion OAuth did not return an access token");
    }
    const workspace = String(tokenJson.workspace_name || tokenJson.workspace_id || "Notion");
    return {
      kind: "notion",
      accountLabel: workspace,
      accessToken,
      refreshToken: null,
      expiresAt: 0,
      scopes: [],
      tokenType: "bearer",
      raw: tokenJson,
    };
  }

  const accessToken = String(tokenJson.access_token || "");
  if (!accessToken) {
    throw new ValidationError(`${provider} OAuth did not return an access token`);
  }
  const refreshToken = tokenJson.refresh_token ? String(tokenJson.refresh_token) : null;
  const expiresIn = Number(tokenJson.expires_in) || 0;
  const scopes = String(tokenJson.scope || "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const accountLabel = await resolveAccountLabel(provider, accessToken);

  return {
    kind: provider,
    accountLabel,
    accessToken,
    refreshToken,
    expiresAt: expiresIn > 0 ? Date.now() + expiresIn * 1000 : 0,
    scopes: scopes.length > 0 ? scopes : SPECS[provider].scopes,
    tokenType: String(tokenJson.token_type || "bearer"),
    raw: tokenJson,
  };
}

async function resolveAccountLabel(provider: GenericOAuthProvider, accessToken: string): Promise<string> {
  try {
    if (provider === "gitlab") {
      const res = await fetch("https://gitlab.com/api/v4/user", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = (await res.json()) as { username?: string; name?: string };
      return json.username || json.name || "GitLab";
    }
    if (provider === "bitbucket") {
      const res = await fetch("https://api.bitbucket.org/2.0/user", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = (await res.json()) as { username?: string; display_name?: string };
      return json.username || json.display_name || "Bitbucket";
    }
    if (provider === "linear") {
      const res = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: "{ viewer { name email } }" }),
      });
      const json = (await res.json()) as {
        data?: { viewer?: { name?: string; email?: string } };
      };
      return json.data?.viewer?.email || json.data?.viewer?.name || "Linear";
    }
    if (provider === "whoop") {
      const res = await fetch("https://api.prod.whoop.com/developer/v1/user/profile/basic", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = (await res.json()) as {
        user_id?: number;
        email?: string;
        first_name?: string;
        last_name?: string;
      };
      const name = [json.first_name, json.last_name].filter(Boolean).join(" ").trim();
      return json.email || name || (json.user_id ? `WHOOP ${json.user_id}` : "WHOOP");
    }
    if (provider === "fitbit") {
      const res = await fetch("https://api.fitbit.com/1/user/-/profile.json", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = (await res.json()) as {
        user?: { displayName?: string; fullName?: string; encodedId?: string };
      };
      return (
        json.user?.displayName ||
        json.user?.fullName ||
        (json.user?.encodedId ? `Fitbit ${json.user.encodedId}` : "Fitbit")
      );
    }
    if (provider === "google_drive" || provider === "google_calendar") {
      const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = (await res.json()) as { email?: string; name?: string };
      return json.email || json.name || (provider === "google_drive" ? "Google Drive" : "Google Calendar");
    }
    if (provider === "figma") {
      const res = await fetch("https://api.figma.com/v1/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = (await res.json()) as { email?: string; handle?: string; id?: string };
      return json.email || json.handle || (json.id ? `Figma ${json.id}` : "Figma");
    }
  } catch {
    // fall through
  }
  return provider;
}

export function parseGenericOAuthSecret(
  provider: GenericOAuthProvider,
  raw: string,
): GenericOAuthSecret | null {
  try {
    const parsed = JSON.parse(raw) as Partial<GenericOAuthSecret>;
    if (parsed.kind !== provider || !parsed.accessToken) return null;
    return {
      kind: provider,
      accountLabel: parsed.accountLabel || provider,
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken ?? null,
      expiresAt: Number(parsed.expiresAt) || 0,
      scopes: Array.isArray(parsed.scopes) ? parsed.scopes.map(String) : [],
      tokenType: parsed.tokenType || "bearer",
      raw: parsed.raw,
    };
  } catch {
    return null;
  }
}

export function genericAccessTokenFromSecret(
  provider: GenericOAuthProvider,
  raw: string,
): string {
  const oauth = parseGenericOAuthSecret(provider, raw);
  return oauth?.accessToken ?? raw;
}

export function asConnectorProvider(provider: GenericOAuthProvider): ConnectorProvider {
  return provider;
}
