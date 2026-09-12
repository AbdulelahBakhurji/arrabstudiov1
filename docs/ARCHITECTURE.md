# Architecture

Arrab Studio is split so the desktop client never holds privileged secrets and so model providers can be added without rewriting product code.

```
Desktop (Tauri / React)
        │  HTTP
        ▼
   Arrab API (Fastify)
        │
        ├── Persistence (memory or Postgres)
        ├── AI Gateway ── OpenAI-compatible + Anthropic adapters
        ├── Connectors (GitHub secrets stay on API)
        ├── Operator + Tasks (Command Center)
        ├── Knowledge + Memories + Task runs (Execution Desk)
        └── GatewayChatRuntime (conversation replies + usage)
```

## Packages

- **shared** — serializable domain types and the public HTTP contract
- **core** — application errors, ports, env helpers
- **ai** — `AiGateway`, `OpenAiCompatibleAdapter`, `AnthropicMessagesAdapter`
- **agents** — `GatewayChatRuntime` for chat; code execution remains unconfigured
- **database** — persistence ports including memberships, connectors, bindings, usage, operator, tasks, knowledge, memories, task runs

## Persistence

Local workspace is seeded on boot. With `DATABASE_URL`, migrations `001`–`006` apply automatically.

## Conversations

1. Desktop creates a conversation for an agent via the API
2. User message is stored
3. If a provider is registered, `GatewayChatRuntime` calls the AI Gateway
4. System context may include GitHub repo metadata, knowledge docs, and agent memories
5. Assistant message is stored; token usage and activity are recorded

Without a provider key, the user message is still saved and the API reports `providerConfigured: false`.

## Connected workforce (Phase 4)

- **Connectors** — GitHub PAT verified and stored only on the API
- **Bindings** — `PUT /v1/projects/:id/repo` links a project to a repo
- **Memberships** — `POST /v1/teams/:id/members` records real team membership
- **Usage** — `GET /v1/usage` aggregates completion token events

## Command Center (Phase 5)

- **Operator** — `GET/PUT /v1/operator` (create seats, then choose)
- **Tasks** — `GET/POST /v1/tasks`, `PATCH/DELETE /v1/tasks/:id`
- **Reports** — `GET /v1/reports/summary`
- Workforce UI modes: Org · Tasks · Chat · Reports
- Cowork receives task context via `arrab.coworkTask` session handoff

## Execution Desk (Phase 6)

- **Knowledge** — `GET/POST /v1/knowledge`, `PATCH/DELETE /v1/knowledge/:id`
- **Memories** — `GET/POST /v1/memories`, `DELETE /v1/memories/:id`
- **Task runs** — `POST /v1/tasks/:id/run`, `GET /v1/task-runs`, `GET /v1/tasks/:id/runs`
- Chat/task runs inject knowledge + agent memories into system context
- Workforce mode **Knowledge**; Tasks board **Run** + run history

## Employee Desk (Phase 7)

- Desktop route `/desk/:agentId` — personal employee screen (search, Teach a task, dock)
- Dock apps: Browser (linked GitHub), Workspace (project/connector), Terminal (Cowork focus)
- Advanced Tasks filters + connector-aware assignment; **Desk** action from Tasks/Chat

## Skills & Approvals (Phase 8)

- **Skills** — `GET/POST /v1/skills`, `DELETE /v1/skills/:id`; Teach a task persists a skill (+ task)
- Skills inject into conversation system context for the employee
- **Approvals** — `GET /v1/approvals`, `GET /v1/approvals/pending`, `POST /v1/approvals`, `POST /v1/approvals/:id/resolve`
- Kinds: `activate_agent`, `run_task`, `git_push`; statuses: pending / approved / rejected
- `POST /v1/tasks/:id/run` accepts `{ requireApproval: true }` → run status `awaiting_approval`
- HQ Pending Approvals loads from API (Approve / Reject); ops toggles gate drafts and high-risk runs

## Agent Workspace (Phase 9)

- Cowork (Boxes) is the agent workspace: choose local folder (Tauri) or GitHub repo (connector picker)
- Chat `workspaceHint` injects folder/repo/git status/tree into the agent system context
- GitHub write APIs: `GET /v1/github/repos/:owner/:repo`, `/tree`, `POST .../commits`, `POST .../pulls`
- Folder mode: commit/push via Tauri `git` with cwd; terminal commands use the same cwd
- Push/PR confirm in UI; optional `git_push` approval when HQ high-risk toggle is on

## Account & Subscriptions (Phase 10)

- `GET /v1/account`, `POST /v1/account/connect`, `/sign-in`, `/disconnect`, `/subscribe`, `PATCH /v1/account`
- Plans: free (100k), pro (2M), team (10M), unlimited — monthly token budgets
- Unconnected studio uses a local soft cap (25k) until an account is connected
- `ConversationService.sendMessage` enforces entitlements before provider calls (`402 QUOTA_EXCEEDED`)
- `GET /v1/usage` and `GET /v1/meta` include entitlement snapshot
- Settings → Account connects the account and redeems subscription codes

## Goals, Streaming, Tools & Team Chat (Phase 12)

- **Goals** — `GET/POST /v1/goals`, `PATCH /v1/goals/:id`, `GET /v1/agents/:id/goals`; injected into chat system context
- **Streaming** — `POST /v1/conversations/:id/messages/stream` SSE (`token` / `done` / `error`)
- **Safe tools** — bounded loop: `summarize_workspace`, `recall_goal`, `list_team`
- **Team chat** — `CreateConversationRequest.teamId`; facilitator agent + team roster context

## Desktop surfaces (current)

- **Studio** — home compose surface
- **Chat** — advanced agent chat with folder / GitHub repo + commit/push/PR
- **Cowork** — AI coworker on this laptop (chat · notes · local terminal)
- **Workforce** — HQ / Execution Desk
- **Connector** — GitHub connect
- **Activity / Settings** (Account · Usage · Connection · Desktop · …)
- **AR / EN** with RTL for Arabic

The local terminal runs only on the user’s laptop via Tauri (`run_local_command`). Agents cannot drive the shell yet.
