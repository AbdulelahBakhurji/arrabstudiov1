# API hardening (0.15.1)

Defense-in-depth on `arrab-api` (systemd → `dist/index.js`). Core path is **not** Docker.

## Controls

| ID | Severity | Fix |
| --- | --- | --- |
| SEC-01 | High | `/v1/billing/confirm` owner + `canAdminister`; removed from public allowlist |
| SEC-02 | High | Secret-shaped JSON responses hard-fail to 500 (`payloadLooksLikeSecretLeak`) |
| SEC-03 | Medium | Rate-limit key = `request.ip` only (no raw `X-Forwarded-For`) |
| SEC-04 | Medium | Loopback CORS origins only when `NODE_ENV ≠ production` |
| SEC-05 | Medium | Unknown `X-Arrab-Family-Member` → `NotFoundError` |
| SEC-06 | Low | Fastify `bodyLimit` 1 MiB, `maxParamLength` 200 |
| SEC-07 | Low | Common passwords rejected on connect / change |
| SEC-08 | High (ops) | Account upsert `ON CONFLICT (id)`; `get()` prefers real operator over smoke fixtures; plan check widened |

## Tests

```bash
pnpm exec vitest run apps/api/src/http/hardening.test.ts \
  apps/api/src/http/authorization-matrix.test.ts \
  apps/api/src/http/security-qa.test.ts
```

## Live smoke

Anonymous `GET /v1/billing/confirm` → **401**.  
`GET /v1/meta` + `/v1/client/hello` → **200**.

See also [SECURITY_CHECKLIST.json](./SECURITY_CHECKLIST.json) and [../SECURITY.md](../SECURITY.md).
