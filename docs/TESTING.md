# Testing

## Layout

| Path | Role |
| --- | --- |
| `apps/api/src/**/*.test.ts` | Unit / integration next to API modules |
| `apps/api/src/http/*` | Authorization matrix, hardening, security-qa, chaos, live contract |
| `apps/api/src/test-support/` | `bootWorld`, FakeProvider — **test-only** |
| `packages/*/src/**/*.test.ts` | Shared / AI / agents / database unit tests |
| `tests/desktop/` | Desktop domain + IPC + seat/role suites (jsdom) |
| `tests/e2e/` | Real browser shells (`pnpm test:e2e`) |
| `tests/architecture.test.ts` | Import boundary enforcement |

There is no separate top-level `tests/unit` tree — tests live with the code they protect, plus cross-cutting suites under `tests/`.

## Commands

```bash
pnpm test                 # full Vitest suite
pnpm test:watch
pnpm test:e2e             # ARRAB_E2E=1
pnpm typecheck
pnpm lint

# Focused security / authz
pnpm exec vitest run \
  apps/api/src/http/hardening.test.ts \
  apps/api/src/http/authorization-matrix.test.ts \
  apps/api/src/http/security-qa.test.ts
```

## Actor fixtures

`bootWorld({ plan: "business" })` builds a studio with owner + org seats (or family seats for family plans). Use `world.as.owner`, `.employee.member`, `.child`, etc.

## What “done” means for a feature

- Happy path through UI → `arrabApi` → API → persistence
- Negative authz (wrong role / other seat / anonymous)
- Entitlement boundary if the feature is plan-gated
- `en` + `ar` copy
- No production path depending on FakeProvider / plan-code shortcuts

## Live API

Optional; skipped unless `ARRAB_LIVE_API_URL` is set:

`apps/api/src/http/live-api.contract.test.ts`
