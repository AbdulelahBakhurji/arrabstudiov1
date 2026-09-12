# Arrab Studio

Build your AI workforce. Create specialized AI employees, connect them to your projects, and organize them into teams that can collaborate on real work.

Arrab Studio is a desktop application (Tauri 2) that talks to the Arrab API. The API owns secrets, persistence, and all communication with model providers. The desktop app never receives OpenAI, Anthropic, or database credentials.

## Current phase: Phase 12 — Goals, Streaming, Tools & Team Chat

- **Goals** — persisted studio/agent goals (`/v1/goals`) injected into every reply until marked done
- **Streaming** — `POST /v1/conversations/:id/messages/stream` (SSE tokens) with Chat UI progressive reveal
- **Safe tools** — agents may call `summarize_workspace`, `recall_goal`, `list_team` in a bounded loop
- **Team chat** — start a conversation with `teamId`; a facilitator agent replies for the squad

Still later: Stripe checkout, OAuth IdP, full autonomous shell control, cloud VM agents.

## Current UI

Floating left icon rail: Studio · Chat · Cowork · Workforce · Connector · Activity · Settings.

- **Chat** — advanced agent chat with folder / GitHub repo, goals, streaming, team mode, commit/push/PR
- **Cowork** — AI coworker on this laptop: open folder, browse/edit files, local git, terminal
- **Settings → Account** — connect account, activate subscription, view token quota

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
```

## Monorepo layout

- `apps/desktop` — Tauri + React studio
- `apps/api` — Fastify Arrab API
- `packages/shared` — domain types + HTTP contract
- `packages/core` — errors, ports, helpers
- `packages/ai` — AI gateway + providers
- `packages/agents` — chat runtime
- `packages/database` — persistence + migrations
