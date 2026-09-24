# Security

Arrab Studio is a **desktop client + cloud API** product. The downloadable app must stay safe for every user: **no secrets in the binary**, **session token guards**, and **connector tokens only on the API**.

## Desktop (what users download)

The desktop application must **never** contain:

- Model provider API keys (`OPENAI_*`, `ANTHROPIC_*`, `OPENROUTER_*`, Bedrock tokens)
- Database credentials / `DATA_ENCRYPTION_KEY`
- GitHub App client secrets, Google/Microsoft OAuth client secrets
- User connector tokens (GitHub, Gmail, etc.)

It may only know the public Arrab API base URL (`VITE_ARRAB_API_URL`) and optional route prefix (`VITE_ARRAB_API_ROUTE_PREFIX`).

### Token guard (desktop → API)

- After sign-in, the app stores an **account session token** locally.
- Every API request sends:
  - `Authorization: Bearer <session>`
  - `X-Arrab-Account-Session: <session>`
- Org employee desks also send `X-Arrab-Employee-Session`.
- Session tokens are **not** API provider keys and are never bundled into the installer.

### Plan token guard (quota finished → stop + pause)

- Before cloud AI sends, the desktop checks cached entitlements (`assertTokensAvailable`).
- When the API returns `402` / `QUOTA_EXCEEDED`, the client **aborts in-flight streams**, marks the account **overLimit**, and shows **QuotaPauseScreen** (upgrade or wait for reset).
- Per-conversation `SESSION_BUDGET_EXCEEDED` stops that reply only (composer notice) without locking the whole app.
- Local Ollama is not blocked by Arrab plan quota.

### Incognito data confidentiality

- Incognito transcripts are stored **only on this device** in the `incognito` device-store namespace.
- At rest they are **AES-GCM encrypted** with a key derived from the user’s vault password (PBKDF2-SHA256, 310k iterations). The unlock key is kept in RAM only and is wiped on lock / leave.
- Cloud model calls for Incognito use **`ephemeral: true`**: the API runs the model **without writing message rows** to the account conversation store. Prior turns are supplied from the on-device vault for that request only.
- After each cloud reply, the disposable API conversation is **deleted**. Normal companion Chat (non-Incognito) still syncs to the signed-in account.
- Vault password minimum: **8 characters**. Lost passwords cannot recover ciphertext.

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
| `/health`, releases, billing plans, connector catalog | All other `/v1/*` (default-deny) |
| Account sign-in / web auth / session verify | `/v1/conversations`, agents, knowledge, billing checkout, disconnect, … |
| OAuth **callbacks** (browser redirect) | `/v1/connectors/*` (except catalog + OAuth callbacks) |
| WhatsApp webhook, org/family member sign-in | `/v1/github/*`, `/v1/org/*`, `/v1/family` |

OAuth **start** requires a signed-in session so strangers cannot bind your GitHub/Gmail apps.

Org capability checks treat a missing employee session as **deny** unless a verified studio account session is present (individual/family owner). Anonymous callers never receive admin capabilities.

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

1. Desktop `.env` / build env has **only** `VITE_ARRAB_API_URL=https://api.arrabai.com` and `VITE_ARRAB_API_ROUTE_PREFIX=/r/nmpi6uidtpkh1bdf` (no secrets)
2. All secrets are on the Arrab API host — not in the app repo or installer
3. GitHub App callback is `https://api.arrabai.com/v1/connectors/github/oauth/callback`
4. Confirm `GET /v1/connectors` without a session returns **401** once an account exists
5. Confirm signed-in desktop can list connectors and complete GitHub browser login
