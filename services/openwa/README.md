# WhatsApp gateway (OpenWA)

Studio shows this as **WhatsApp** (QR linking). OpenWA is the self-hosted gateway behind it.

Arrab can send and receive WhatsApp through a self-hosted [OpenWA](https://github.com/rmyndharis/OpenWA) server instead of Meta Cloud API.

## Quick setup

**Production (API VPS):**

```bash
APP_DIR=/opt/arrab-studio bash scripts/setup-openwa-api-server.sh
systemctl restart arrab-api
```

This runs OpenWA on the same host as `@arrab/api`, writes `OPENWA_API_KEY`, `OPENWA_BASE_URL`, and `OPENWA_WEBHOOK_SECRET` into the API `.env`, and registers webhooks. Studio clients only use QR linking.

**Local dev:**

```bash
pnpm openwa:setup
```

Then set `OPENWA_API_KEY` in the API `.env` (same key as `services/openwa/vendor/data/.api-key`).

1. Set **`OPENWA_API_KEY`** on the Arrab API to the admin key from `services/openwa/vendor/data/.api-key`.
2. Set **`OPENWA_WEBHOOK_SECRET`** (16+ chars) so inbound messages reach the API.
3. In Arrab Studio, tap **Connect WhatsApp** (Companions or Connectors → WhatsApp → Quick connect) and scan the QR.
4. Start the Arrab API locally (`pnpm dev:api`) so webhooks can reach `http://127.0.0.1:8787/v1/connectors/openwa/webhook`.

Each signed-in profile gets its own OpenWA session name. Incoming messages create a desk job, the linked companion drafts a reply, and sends automatically when desk **pace** is **allow** (otherwise you approve in the desk).
