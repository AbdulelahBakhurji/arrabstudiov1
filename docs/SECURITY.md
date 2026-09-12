# Security

## Desktop

The desktop application must not contain:

- Model provider API keys
- Database credentials
- Privileged API secrets

It may only know the Arrab API base URL (`VITE_ARRAB_API_URL`).

## API

- Secrets load from environment variables. Never commit `.env`.
- Bind to `127.0.0.1` by default in Phase 1.
- Validate configuration at boot.
- CORS is an explicit allowlist.
- Future agent execution must not run on the API process.
- GitHub write (commit / push / PR) uses the connector PAT on the API only; desktop never stores the token.
- Local folder paths stay on the desktop; Tauri runs `git` in that cwd — agents do not drive unconstrained shell yet.

## Keys

`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and other provider credentials are API-only. They are parsed on the server so they are ready for adapters; they are never returned by HTTP handlers.

GitHub PATs for agent workspace commit/push need the `repo` scope (or fine-grained Contents + Pull requests write).
