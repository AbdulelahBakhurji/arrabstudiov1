# Arrab Studio

Build your AI workforce. Create specialized AI employees, connect them to your projects, and organize them into teams that can collaborate on real work.

Arrab Studio is a desktop application (Tauri 2) that talks to the Arrab API. The API owns secrets, persistence, and all communication with model providers. The desktop app never receives OpenAI, Anthropic, or database credentials.

## Security

- Desktop ships with **only** the public API URL — no provider keys or connector secrets in the installer.
- Account session tokens guard connector and GitHub APIs. See [docs/SECURITY.md](./docs/SECURITY.md).


- **Goals** — persisted studio/agent goals (`/v1/goals`) injected into every reply until marked done
- **Streaming** — `POST /v1/conversations/:id/messages/stream` (SSE tokens) with Chat UI progressive reveal
- **Safe tools** — agents may call `summarize_workspace`, `recall_goal`, `list_team` in a bounded loop
- **Team chat** — start a conversation with `teamId`; a facilitator agent replies for the squad

Still later: Stripe checkout, OAuth IdP, full autonomous shell control, cloud VM agents.

## Current UI

Main desktop frontend: `apps/desktop` (individuals + organizations).

- **Individuals** — companions chat, board, work, me, connectors, account, settings
- **Organizations** — studio home, chat, cowork, workforce, employee desk, activity, connectors, account, settings
- **iOS** — native SwiftUI client in `apps/ios` (Chat, Studio, Brain, Tasks, Me + API / PC link)
- Design preview (offline HTML): `docs/design/desktop/Arrab-Design.html`

## Requirements

- Node.js 22+
- pnpm 10 (`corepack enable`)
- Rust stable (for the Tauri desktop app)
- Optional: PostgreSQL
- Optional: `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY` for live employee replies

## Setup

```bash
pnpm install
cp .env.example .env
cp apps/desktop/.env.example apps/desktop/.env
```

Set provider keys in `.env` to enable AI replies. Leave unset to store user messages only.

## Commands

```bash
pnpm dev:api
pnpm dev:desktop

pnpm typecheck
pnpm lint
pnpm test
pnpm build

# Scaffold a new feature slice (page + checklist)
pnpm new:feature my-thing
pnpm new:feature my-thing --audience=individual,family --api

# Ship installers (Mac .app/.dmg · Windows NSIS/MSI)
pnpm ship:mac
pnpm ship:windows
pnpm ship
```

See [docs/FEATURE.md](./docs/FEATURE.md) for the agile checklist when adding features.
See [docs/DESKTOP_RELEASE.md](./docs/DESKTOP_RELEASE.md) for packaging, signing, and CI.

## Monorepo layout

```text
apps/
  desktop/          # Tauri + React — main Studio UI (+ packaging/)
  api/              # Fastify Arrab API
  testingworkspace/ # Internal testing workspace
packages/
  shared/           # Domain types + HTTP contract
  core/             # Errors, ports, helpers
  ai/               # AI gateway + providers
  agents/           # Chat runtime
  database/         # Persistence + migrations
brand/              # Canonical logo + symbol
docs/               # Architecture, security, design, release
scripts/            # Dev + ship scripts (macOS / Windows)
tests/              # Cross-package / desktop UI tests
release/artifacts/  # Built installers (local / CI output)
```
