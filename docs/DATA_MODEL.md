# Data model

## Seeded

- **organization** `org_local_studio`
- **workspace** `ws_local_studio`

## Writable

- **project**, **agent**, **team**, **activity**
- **conversation** — thread tied to an agent (and optional project)
- **message** — user / assistant / system / tool turns
- **team_membership** — agent ↔ team links
- **connector** — provider connection + secret (API only)
- **project_repo_binding** — project ↔ GitHub repo
- **usage_event** — token usage from completions
- **operator_profile** — operator seat catalog + chosen title
- **task** — assignable work with status and priority
- **knowledge_doc** — workspace/project knowledge injected into AI context
- **memory** — short agent notes from runs / explicit writes
- **task_run** — execution record for `POST /v1/tasks/:id/run`
- **skill** — taught capability per agent (injected into chat context)
- **approval** — human gate for activate_agent / run_task / git_push
- **project_repo_binding.default_branch** — optional default branch for workspace git

## Typed, not persisted yet

tool, permission, model_provider, user

## Postgres migrations

1. `001_core` — org, workspace, projects, agents, teams, activity
2. `002_conversations` — conversations, messages
3. `003_connected_workforce` — memberships, connectors, bindings, usage events
4. `004_command_center` — operator_profiles, tasks
5. `005_operator_seats` — seats array / nullable title on operator
6. `006_execution_desk` — knowledge_docs, memories, task_runs
7. `007_skills_approvals` — skills, approvals; task_runs `awaiting_approval`
8. `008_agent_workspace` — approvals `git_push`; bindings `default_branch`
