import { ValidationError } from "@arrab/core";
import type { StartGmailOAuthResponse } from "@arrab/shared";
import { randomBytes } from "node:crypto";

const GITHUB_AUTHORIZE = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN = "https://github.com/login/oauth/access_token";
const GITHUB_API = "https://api.github.com";
const GITHUB_HEADERS = {
  Accept: "application/vnd.github+json",
  "User-Agent": "Arrab-Studio",
  "X-GitHub-Api-Version": "2022-11-28",
} as const;

export type GithubOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** App slug for install URL (https://github.com/apps/{slug}). */
  appSlug?: string;
};

export type GithubOAuthSecret = {
  kind: "github";
  login: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  scopes: string[];
  tokenType: string;
  installationId: string | null;
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

export function parseGithubOAuthSecret(raw: string): GithubOAuthSecret | null {
  try {
    const parsed = JSON.parse(raw) as Partial<GithubOAuthSecret>;
    if (parsed.kind !== "github" || !parsed.login || !parsed.accessToken) {
      return null;
    }
    return {
      kind: "github",
      login: parsed.login,
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken ?? null,
      expiresAt: Number(parsed.expiresAt) || 0,
      scopes: Array.isArray(parsed.scopes) ? parsed.scopes.map(String) : [],
      tokenType: parsed.tokenType || "bearer",
      installationId: parsed.installationId ?? null,
    };
  } catch {
    return null;
  }
}

/** Raw PAT string, or OAuth JSON → access token for API calls. */
export function githubAccessTokenFromSecret(raw: string): string {
  const oauth = parseGithubOAuthSecret(raw);
  return oauth?.accessToken ?? raw;
}

export function newGithubOAuthState(): string {
  return randomBytes(24).toString("hex");
}

export function buildGithubAuthUrl(
  config: GithubOAuthConfig,
  state: string,
): StartGmailOAuthResponse {
  if (!config.clientId.trim() || !config.clientSecret.trim()) {
    throw new ValidationError(
      "GitHub OAuth is not configured (GITHUB_APP_CLIENT_ID / GITHUB_APP_CLIENT_SECRET)",
    );
  }
  const slug = config.appSlug?.trim();
  if (slug) {
    // Install + optional user OAuth during installation (Cursor-style).
    const params = new URLSearchParams({ state });
    return {
      url: `https://github.com/apps/${encodeURIComponent(slug)}/installations/new?${params}`,
      state,
    };
  }
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    state,
  });
  return { url: `${GITHUB_AUTHORIZE}?${params.toString()}`, state };
}

export async function exchangeGithubAuthCode(
  config: GithubOAuthConfig,
  code: string,
  installationId?: string | null,
): Promise<GithubOAuthSecret> {
  const token = await postGithubToken({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.redirectUri,
  });
  if (!token.access_token) {
    throw new ValidationError(
      token.error_description || token.error || "GitHub did not return an access token",
    );
  }
  const login = await fetchGithubLogin(token.access_token);
  const expiresIn = Number(token.expires_in) || 0;
  return {
    kind: "github",
    login,
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? null,
    expiresAt: expiresIn > 0 ? Date.now() + Math.max(60, expiresIn) * 1000 : 0,
    scopes: (token.scope || "").split(/[,\s]+/).filter(Boolean),
    tokenType: token.token_type || "bearer",
    installationId: installationId?.trim() || null,
  };
}

export async function refreshGithubOAuthSecret(
  config: GithubOAuthConfig,
  secret: GithubOAuthSecret,
): Promise<GithubOAuthSecret> {
  if (!secret.refreshToken) {
    return secret;
  }
  if (secret.expiresAt > 0 && secret.expiresAt > Date.now() + 60_000) {
    return secret;
  }
  const token = await postGithubToken({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
    refresh_token: secret.refreshToken,
  });
  if (!token.access_token) {
    throw new ValidationError(
      token.error_description ||
        token.error ||
        "Failed to refresh GitHub access token — reconnect GitHub",
    );
  }
  const expiresIn = Number(token.expires_in) || 0;
  return {
    ...secret,
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? secret.refreshToken,
    expiresAt: expiresIn > 0 ? Date.now() + Math.max(60, expiresIn) * 1000 : secret.expiresAt,
    tokenType: token.token_type || secret.tokenType,
    scopes: token.scope
      ? token.scope.split(/[,\s]+/).filter(Boolean)
      : secret.scopes,
  };
}

export async function verifyGithubOAuthSecret(
  config: GithubOAuthConfig,
  secret: GithubOAuthSecret,
): Promise<{ label: string; scopes: string[]; secret: GithubOAuthSecret }> {
  const fresh = await refreshGithubOAuthSecret(config, secret);
  const login = await fetchGithubLogin(fresh.accessToken);
  return {
    label: login,
    scopes: fresh.scopes.length > 0 ? fresh.scopes : ["github-app"],
    secret: { ...fresh, login },
  };
}

async function fetchGithubLogin(accessToken: string): Promise<string> {
  const response = await fetch(`${GITHUB_API}/user`, {
    headers: {
      ...GITHUB_HEADERS,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) {
    throw new ValidationError("GitHub rejected this OAuth token");
  }
  const payload = (await response.json()) as { login?: string };
  return payload.login || "github-user";
}

async function postGithubToken(body: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(GITHUB_TOKEN, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "Arrab-Studio",
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as TokenResponse;
  if (!response.ok && !payload.error) {
    throw new ValidationError(`GitHub token exchange failed (${response.status})`);
  }
  return payload;
}
