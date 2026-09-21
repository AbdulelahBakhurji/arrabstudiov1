# Security

Arrab Studio is a **desktop client + cloud API** product. The downloadable app must stay safe for every user: **no secrets in the binary**, **session token guards**, and **connector tokens only on the API**.

## Desktop (what users download)

The desktop application must **never** contain:

- Model provider API keys (`OPENAI_*`, `ANTHROPIC_*`, `OPENROUTER_*`, Bedrock tokens)
- Database credentials / `DATA_ENCRYPTION_KEY`
- GitHub App client secrets, Google/Microsoft OAuth client secrets
- User connector tokens (GitHub, Gmail, etc.)

It may only know the public Arrab API base URL (`VITE_ARRAB_API_URL`).

### Token guard (desktop → API)

- After sign-in, the app stores an **account session token** locally.
- Every API request sends:
  - `Authorization: Bearer <session>`
  - `X-Arrab-Account-Session: <session>`
- Org employee desks also send `X-Arrab-Employee-Session`.
- Session tokens are **not** API provider keys and are never bundled into the installer.

### Tauri hardening

- CSP restricts network access to Arrab API hosts + localhost for development.
- DevTools are disabled in release builds.
- Capabilities deny internal DevTools toggles.

## API (server only)

- Secrets load from environment variables. **Never commit `.env`.**
- Connector secrets are encrypted at rest (`DATA_ENCRYPTION_KEY`) and **never** returned in `ConnectorPublic` payloads.
- GitHub / Gmail / Outlook OAuth tokens live only on the API.
- CORS is an explicit allowlist (desktop / Tauri origins).
- Auth endpoints and OAuth starts are **rate-limited**.
- When a studio account exists, **connector and GitHub routes require a valid session**.

### Public vs protected

| Public | Session required (when account exists) |
| --- | --- |
| `/health`, releases, billing plans | `/v1/connectors/*` (except catalog + OAuth callbacks) |
| Account sign-in / web auth / session verify | `/v1/github/*` |
| OAuth **callbacks** (browser redirect) | |

OAuth **start** requires a signed-in session so strangers cannot bind your GitHub/Gmail apps.

## Keys & connectors

- Provider keys are API-only and never returned by HTTP handlers.
- GitHub App OAuth preferred for end users (browser login). Legacy PAT connect is blocked when GitHub OAuth is configured.
- GitHub write (commit / PR) uses the connector credential **on the API only**.

## Repo hygiene

Ignored / never ship:

- `.env`, `.env.*` (except `*.example`)
- `*.pem`, `*.key`, credential JSON
- `release/artifacts/`, installers
- Local oversized design dumps

## Operator checklist before shipping

1. Desktop `.env` / build env has **only** `VITE_ARRAB_API_URL=https://api.arrabai.com`
2. All secrets are on Railway / API host — not in the app repo or installer
3. GitHub App callback is `https://api.arrabai.com/v1/connectors/github/oauth/callback`
4. Confirm `GET /v1/connectors` without a session returns **401** once an account exists
5. Confirm signed-in desktop can list connectors and complete GitHub browser login
