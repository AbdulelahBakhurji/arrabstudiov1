# QA: roles, plans, permissions and how they are tested

Everything below is derived from the implementation, not the marketing copy, and is enforced by tests
that run in CI (`pnpm test`) — plus a real-browser suite (`pnpm test:e2e`).

## Actors that actually exist

| Actor                                                          | How they authenticate             | Scope                                                                                                                                                                             |
| -------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anonymous                                                      | none                              | Only the explicit public list (sign-in, OAuth callbacks, signed webhooks, `/v1/client/hello`, plan catalog)                                                                       |
| Account owner (Individual / Family parent / Org billing owner) | account session (device sessions) | Everything, including plan, billing, devices                                                                                                                                      |
| Org employee seat: `admin`, `manager`, `member`                | `X-Arrab-Employee-Session`        | Never administers. `manager`/`admin` may assign work and run workforce operations; `member` may not. `admin` seats additionally see all agents/tasks/chats (see _open questions_) |
| Family seat: `child`, `partner`/`parent`                       | seat session bound to the member  | Never account-level actions. `partner`/`parent` manage the household; `child` is least-privilege and isolated                                                                     |

There is **no** `Ultra` plan, no "Guest" server role and no "Support/admin" role in the implementation.

## Plans (generated from the catalog: `pnpm qa:matrix`)

See [QA-MATRIX.md](./QA-MATRIX.md). Plans in the code: Free, Solo, Pro (legacy), Studio, Family Free, Family,
Family Plus, Team, Business, Enterprise, Scale (legacy id `unlimited`).

## Enforcement map (what the server actually enforces)

| Rule                                                                | Enforced by                              | Test                                                                 |
| ------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------- |
| Default-deny: no session ⇒ 401 on every non-public route            | `registerSecurity`                       | `authorization-matrix.test.ts` sweeps the whole route table          |
| Account-level routes are owner-only                                 | `route-policy.ts` + `assertOwnerSession` | matrix: every employee role, child and partner refused               |
| Workforce operations need manager/owner                             | `route-policy.ts`                        | matrix per role                                                      |
| Org administration (seats, departments, hiring) is owner-only       | `OrgWorkforceService.assertActorCan`     | matrix + role-escalation tests                                       |
| Org features need an organization plan; seats die on downgrade      | `plan.orgWorkforce`                      | `plan-entitlements.test.ts`                                          |
| Household features need a family plan; seat limits exact            | family service + plan                    | `plan-entitlements.test.ts`                                          |
| Token limit, top-ups, expiry, past-due, cancel, renewal             | `AccountService`                         | `subscription-lifecycle.test.ts` (every plan at limit-1 / at / over) |
| Concurrent replies cannot overshoot the allowance                   | `reserveTokens`                          | `concurrency.test.ts`                                                |
| Paid invoices are single-use; paid plans are not redeemable by code | billing + account service                | lifecycle + `plan-codes.test.ts`                                     |
| Models limited to the offered catalog                               | `ConversationService.resolveModel`       | `ai-qa.test.ts`                                                      |
| Provider failures never read as "you were logged out"               | `clientStatusForProvider`                | `provider-http.test.ts`, `ai-qa.test.ts`                             |
| Model-requested dangerous tools become approvals                    | runtime `requiresApproval`               | `ai-qa.test.ts` (9 tools)                                            |
| Seat/child data isolation                                           | conversation/sync/vault owner keys       | `data-isolation.test.ts`                                             |
| Tauri IPC: every command checks its window; capabilities minimal    | Rust + `tauri.conf.json`                 | `tauri-ipc-audit.test.ts` (static)                                   |

## Open questions that need a product decision (not bugs I could safely "fix")

1. **`admin` seat vs "seats never administer".** `filterAgents/Tasks/Conversations` let an admin-role seat see everything
   (including other seats' private chats) while `permissionsFor` denies admin-role seats every admin action, and the app
   shows them the Workforce page. Pick one model.
2. **"1 AI employee" on Free** cannot be enforced as written: the desktop creates one backing agent per companion/chat.
   The cap exists (`setAgentLimit`) and is tested, but is off until "AI employee" is a server-side concept.
3. **No plan-based model tiers.** "Priority model routing" is advertised on paid plans; every plan can use every model
   in the catalog. (`it.todo` in `ai-qa.test.ts`.)
4. **Pricing anomalies:** Scale (399 SAR, 50M tokens, 250 seats) undercuts Business (749 SAR, 40M, 25 seats); Pro (49 SAR)
   is cheaper than Solo (119) with fewer tokens; there is no Ultra.
5. **No grace period** after a failed/expired payment: AI stops at the period boundary.
6. ~~**Seats on their own device.**~~ **Fixed (desktop):** `SignInPage` email/password tries account → family seat →
   org employee. Org seats clear any owner bearer and enter via employee session; `AuthGate` / `RoleFromPath` accept
   org seats without an account token. Owner-side seat preview in Org Administration still optional.
7. **Single studio per API process** (`persistence.accounts.get()`): tenant/organization isolation between _customers_
   cannot exist yet — only isolation between users _inside_ one studio is tested.

## Live production host (api.arrabai.com) — verified 2026-10-02

| Check | Result |
| --- | --- |
| `GET …/health` | PASS — `arrab-api` ok |
| `GET …/v1/meta` | PASS — version **0.14.0**, persistence `postgres` |
| Auth validation / non-enumeration | PASS (live contract suite) |
| Plan catalog on host | **DRIFT** — host serves `starter` / `max` / `family-plus` (hyphen); this repo's catalog is Solo/Studio/Team/… (0.15) |
| `GET …/v1/client/hello` | **MISSING on host** (404) — present in this repo |
| Desktop release `VITE_ARRAB_*` | Points at `https://api.arrabai.com` + Coolify prefix |

**Certification implication:** this tree (0.15) is tested against its own API in CI. The public host must be redeployed from this tree before claiming end-to-end production parity. Optional live probe:

```bash
ARRAB_LIVE_API_URL=https://api.arrabai.com/r/nmpi6uidtpkh1bdf pnpm exec vitest run apps/api/src/http/live-api.contract.test.ts
```

Docker is **not** part of the Arrab API/desktop production path. Remaining Docker usage is only the optional OpenWA WhatsApp sidecar (`services/openwa`).
