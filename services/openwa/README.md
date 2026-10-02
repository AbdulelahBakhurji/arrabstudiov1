# WhatsApp gateway (OpenWA)

Studio shows this as **WhatsApp** (QR linking). OpenWA is the self-hosted gateway behind it.

Arrab can send and receive WhatsApp through a self-hosted [OpenWA](https://github.com/rmyndharis/OpenWA) server instead of Meta Cloud API.

## Quick setup

**Production (API VPS):**

```bash
APP_DIR=/opt/arrab-studio bash scripts/setup-openwa-api-server.sh
systemctl restart arrab-api
```

**Optional connector only.** Arrab Studio's API and desktop do not require Docker. OpenWA is an
optional WhatsApp gateway sidecar; skip this entire directory if you are not using OpenWA.

This runs OpenWA on the same host as `@arrab/api`, writes `OPENWA_API_KEY`, `OPENWA_BASE_URL`, and `OPENWA_WEBHOOK_SECRET` into the API `.env`, allowlists the Docker host for webhooks (`SSRF_ALLOWED_HOSTS`), and registers webhooks. Studio clients only use QR linking.

**Local dev:**

```bash
pnpm openwa:setup
```

Then set in the Arrab API `.env`:

1. **`OPENWA_API_KEY`** — admin key from `services/openwa/vendor/data/.api-key`
2. **`OPENWA_WEBHOOK_SECRET`** — 16+ chars (must match the secret registered on OpenWA webhooks)
3. **`OPENWA_BASE_URL=http://127.0.0.1:2785`** (default)

Then:

1. Start the Arrab API (`pnpm dev:api`) so webhooks can reach `http://host.docker.internal:8787/v1/connectors/openwa/webhook`
2. In Arrab Studio, tap **Connect WhatsApp** (Companions or Connectors → WhatsApp → Quick connect) and scan the QR in the app

Each signed-in profile gets its own OpenWA session **name** (`as-…`). OpenWA’s HTTP routes use a **UUID** path id; Arrab stores that as `gatewayId` after create. Incoming messages create a desk job, the linked companion drafts a reply, and sends automatically when desk **pace** is **allow** (otherwise you approve in the desk).

## Webhooks and SSRF

OpenWA validates webhook URLs with an SSRF guard (private ranges blocked by default). The setup scripts set:

```env
SSRF_ALLOWED_HOSTS=host.docker.internal,127.0.0.1,localhost
WEBHOOK_SSRF_PROTECT=true
```

On a Linux VPS the allowlist also includes `172.17.0.1` (Docker bridge → host API). If inbound messages never arrive, check OpenWA logs for SSRF blocks and that Arrab’s API is reachable from the OpenWA container at the registered webhook URL.
