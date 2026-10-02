# Deploy Arrab API (production)

Public host: `https://api.arrabai.com/r/nmpi6uidtpkh1bdf`  
Host path: `/root/arrab/platform` (override with `APP_DIR` if needed)  
Service: `arrab-api` (systemd → `dist/index.js`)

Desktop release builds already point at that URL (`VITE_ARRAB_API_URL` + route prefix).

## Why redeploy

Live host was observed on **0.14.0** with plan ids `starter` / `max` / `family-plus`.
This repo is **0.15** (Solo / Studio / Team catalog, `/v1/client/hello`, device sessions, sync).

Until the VPS runs this tree, desktop 0.15 and the public API are not the same product surface.

## Deploy paths

### A. GitHub Actions (preferred)

Workflow: `.github/workflows/api-deploy.yml`

Requires secrets:

- `ARRAB_VPS_HOST`
- `ARRAB_VPS_USER`
- `ARRAB_VPS_SSH_KEY`

Push to `main` (paths under `apps/api`, `packages/*`, deploy scripts) or run **workflow_dispatch**.

### B. On the VPS

```bash
ssh arrab 'bash -s' < scripts/deploy-api-vps.sh
# or on the host:
APP_DIR=/root/arrab/platform bash scripts/deploy-api-vps.sh
```

## Smoke after deploy

```bash
curl -fsS https://api.arrabai.com/r/nmpi6uidtpkh1bdf/health
curl -fsS https://api.arrabai.com/r/nmpi6uidtpkh1bdf/v1/meta
# Expect 200 after 0.15 deploy:
curl -fsS https://api.arrabai.com/r/nmpi6uidtpkh1bdf/v1/client/hello

ARRAB_LIVE_API_URL=https://api.arrabai.com/r/nmpi6uidtpkh1bdf \
  pnpm exec vitest run apps/api/src/http/live-api.contract.test.ts
```

## Notes

- Core API is **systemd** (`arrab-api`), not Docker.
- Docker is only for the optional OpenWA WhatsApp sidecar.
- Single-tenant limit still applies (`persistence.accounts.get()`); use `ARRAB_SIGNUP_EMAILS` until multi-tenant lands.
