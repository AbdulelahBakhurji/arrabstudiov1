# Contributing

## Before you change code

1. Read [AGENTS.md](../AGENTS.md) (repo map for humans and agents).
2. Read [FEATURE.md](./FEATURE.md) if you are adding a surface.
3. Keep PRs thin — one outcome; no drive-by refactors.
4. Never commit `.env`, credentials, or provider keys.

## Local setup

See [DEVELOPMENT.md](./DEVELOPMENT.md).

## Pull requests

- Bilingual copy (`en` + `ar`) for every new user-facing string.
- Shared contract first: types live in `packages/shared` before the client invents shapes.
- Server enforces authz/entitlements; UI mirrors for UX only.
- Add or update tests next to the change (API) or under `tests/` (cross-cutting / desktop).
- Run `pnpm typecheck` and focused `pnpm test` (or full suite for auth/billing/security).

## Where to put work

| Kind of change | Where |
| --- | --- |
| New desktop page | `pnpm new:feature` → `apps/desktop/src/features/modules/` |
| Domain UI / logic | `apps/desktop/src/domains/<domain>/` |
| API endpoint | `apps/api/src/modules/<domain>/` + register in `http/v1.ts` |
| Types / HTTP contract | `packages/shared` |
| Persistence / migration | `packages/database` |
| AI provider adapter | `packages/ai` |
| Chat runtime / tools | `packages/agents` |
| Docs | `docs/` |

## Security

Follow [SECURITY.md](./SECURITY.md) and [security/HARDENING.md](./security/HARDENING.md).
Desktop never receives provider keys or connector secrets.
