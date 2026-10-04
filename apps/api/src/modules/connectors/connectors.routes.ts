import { withRequestActor } from "../../platform/context/request-actor.js";
import { ValidationError } from "@arrab/core";
import { extractWhatsAppInbound } from "./whatsapp-connector.js";
import type { ConnectConnectorRequest, GithubCommitRequest, GithubCreatePullRequest, SendEmailRequest, SendWhatsAppRequest, ArrangeEmailRequest, OpenWaLinkStartRequest } from "@arrab/shared";
import type { FastifyInstance } from "fastify";
import type { V1Deps } from "../../http/deps.js";
import { escapeHtml, isSafeRedirectUrl, jsonForScript } from "../../platform/http/html-safe.js";

function oauthDesktopBridgeHtml(input: {
  provider:
    | "gmail"
    | "outlook"
    | "github"
    | "gitlab"
    | "bitbucket"
    | "linear"
    | "slack"
    | "notion"
    | "whoop"
    | "fitbit"
    | "google_drive"
    | "google_calendar"
    | "figma";
  nextUrl: string;
  ok: boolean;
}): string {
  const deepLink = input.ok
    ? `arrab://connectors/connected?provider=${encodeURIComponent(input.provider)}`
    : `arrab://connectors/error?provider=${encodeURIComponent(input.provider)}`;
  const safeNextUrl = isSafeRedirectUrl(input.nextUrl) ? input.nextUrl : deepLink;
  const title = input.ok ? "Connected" : "Connection failed";
  const body = input.ok
    ? `Opening Arrab Studio… ${input.provider} is ready.`
    : `Could not finish ${input.provider}. Returning to Arrab…`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Arrab Studio · ${title}</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: ui-sans-serif, system-ui, sans-serif; background: #050505; color: #f5f5f5; }
    .card { width: min(420px, calc(100vw - 2rem)); border: 1px solid rgba(255,255,255,.12); border-radius: 24px; background: #0a0a0a; padding: 28px; text-align: center; }
    h1 { margin: 0; font-size: 1.25rem; font-weight: 560; letter-spacing: -0.03em; }
    p { color: #a3a3a3; font-size: .9rem; line-height: 1.5; }
    a { color: #bbf7d0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p id="msg">${body}</p>
    <p><a id="open" href="${escapeHtml(deepLink)}">Open Arrab Studio</a></p>
  </div>
  <script>
    (function () {
      var deep = ${jsonForScript(deepLink)};
      var next = ${jsonForScript(safeNextUrl)};
      try { window.location.href = deep; } catch (e) {}
      window.setTimeout(function () {
        window.location.replace(next);
      }, 700);
    })();
  </script>
</body>
</html>`;
}
export function registerConnectorsRoutes(app: FastifyInstance, deps: V1Deps): void {
  app.get("/v1/connectors/catalog", async () => ({ items: deps.connectors.catalog() }));

  app.get("/v1/connectors", async (request) => {
    if (!request.account && !request.orgEmployee) return { items: [] };
    return { items: await deps.connectors.list() };
  });

  app.post<{ Body: ConnectConnectorRequest }>("/v1/connectors", async (request) =>
    deps.connectors.connect(request.body ?? { provider: "github", token: "" }),
  );

  app.post("/v1/connectors/gmail/oauth/start", async () => deps.connectors.startGmailOAuth());

  app.get<{
    Querystring: { code?: string; state?: string; error?: string };
  }>("/v1/connectors/gmail/oauth/callback", async (request, reply) => {
    const result = await deps.connectors.completeGmailOAuth({
      code: request.query.code,
      state: request.query.state,
      error: request.query.error,
    });
    return reply.type("text/html").send(
      oauthDesktopBridgeHtml({
        provider: "gmail",
        nextUrl: result.redirectUrl,
        ok: !result.redirectUrl.includes("error"),
      }),
    );
  });

  app.post("/v1/connectors/github/oauth/start", async () => deps.connectors.startGithubOAuth());

  app.get<{
    Querystring: {
      code?: string;
      state?: string;
      error?: string;
      error_description?: string;
      installation_id?: string;
      setup_action?: string;
    };
  }>("/v1/connectors/github/oauth/callback", async (request, reply) => {
    const result = await deps.connectors.completeGithubOAuth({
      code: request.query.code,
      state: request.query.state,
      error: request.query.error,
      errorDescription: request.query.error_description,
      installationId: request.query.installation_id,
    });
    return reply.type("text/html").send(
      oauthDesktopBridgeHtml({
        provider: "github",
        nextUrl: result.redirectUrl,
        ok: !result.redirectUrl.includes("error"),
      }),
    );
  });

  app.post("/v1/connectors/outlook/oauth/start", async () => deps.connectors.startOutlookOAuth());

  app.get<{
    Querystring: { code?: string; state?: string; error?: string; error_description?: string };
  }>("/v1/connectors/outlook/oauth/callback", async (request, reply) => {
    const result = await deps.connectors.completeOutlookOAuth({
      code: request.query.code,
      state: request.query.state,
      error: request.query.error_description || request.query.error,
    });
    return reply.type("text/html").send(
      oauthDesktopBridgeHtml({
        provider: "outlook",
        nextUrl: result.redirectUrl,
        ok: !result.redirectUrl.includes("error"),
      }),
    );
  });

  for (const provider of [
    "gitlab",
    "bitbucket",
    "linear",
    "slack",
    "notion",
    "whoop",
    "fitbit",
    "google_drive",
    "google_calendar",
    "figma",
  ] as const) {
    app.post(`/v1/connectors/${provider}/oauth/start`, async () =>
      deps.connectors.startGenericOAuth(provider),
    );
    app.get<{
      Querystring: { code?: string; state?: string; error?: string; error_description?: string };
    }>(`/v1/connectors/${provider}/oauth/callback`, async (request, reply) => {
      const result = await deps.connectors.completeGenericOAuth(provider, {
        code: request.query.code,
        state: request.query.state,
        error: request.query.error,
        errorDescription: request.query.error_description,
      });
      return reply.type("text/html").send(
        oauthDesktopBridgeHtml({
          provider,
          nextUrl: result.redirectUrl,
          ok: !result.redirectUrl.includes("error"),
        }),
      );
    });
  }
  app.post<{ Params: { id: string } }>("/v1/connectors/:id/verify", async (request) =>
    deps.connectors.verify(request.params.id),
  );

  app.get<{ Params: { id: string }; Querystring: { q?: string } }>(
    "/v1/connectors/:id/resources",
    async (request) => ({
      items: await deps.connectors.resources(request.params.id, request.query.q),
    }),
  );

  app.post<{ Params: { id: string }; Body: { command?: string } }>(
    "/v1/connectors/:id/ssh/exec",
    async (request) =>
      deps.connectors.execSsh(request.params.id, { command: request.body?.command ?? "" }),
  );

  app.delete<{ Params: { id: string } }>("/v1/connectors/:id", async (request) =>
    deps.connectors.disconnect(request.params.id),
  );


  app.get<{
    Params: { id: string };
    Querystring: { mailbox?: string; limit?: string };
  }>("/v1/connectors/:id/email/messages", async (request) => {
    const limit = Number(request.query.limit || "30");
    return deps.connectors.listEmailMessages(
      request.params.id,
      request.query.mailbox || "INBOX",
      Number.isFinite(limit) ? limit : 30,
    );
  });

  app.get<{
    Params: { id: string; uid: string };
    Querystring: { mailbox?: string };
  }>("/v1/connectors/:id/email/messages/:uid", async (request) =>
    deps.connectors.readEmail(request.params.id, request.params.uid, request.query.mailbox || "INBOX"),
  );

  app.post<{ Params: { id: string }; Body: SendEmailRequest }>(
    "/v1/connectors/:id/email/send",
    async (request) =>
      deps.connectors.sendEmail(request.params.id, request.body ?? { to: "", subject: "", text: "" }),
  );

  app.post<{ Params: { id: string }; Body: ArrangeEmailRequest }>(
    "/v1/connectors/:id/email/arrange",
    async (request) =>
      deps.connectors.arrangeEmail(request.params.id, request.body ?? { action: "archive", messageIds: [] }),
  );


  app.get<{
    Querystring: {
      "hub.mode"?: string;
      "hub.verify_token"?: string;
      "hub.challenge"?: string;
    };
  }>("/v1/connectors/whatsapp/webhook", async (request, reply) => {
    const challenge = deps.connectors.verifyWhatsAppWebhookChallenge(request.query);
    return reply.type("text/plain").send(challenge);
  });


  app.post("/v1/connectors/openwa/webhook", async (request) => {
    const rawBody =
      typeof (request as unknown as { rawBody?: string }).rawBody === "string"
        ? (request as unknown as { rawBody: string }).rawBody
        : JSON.stringify(request.body ?? {});
    const signature =
      typeof request.headers["x-openwa-signature"] === "string"
        ? request.headers["x-openwa-signature"]
        : undefined;
    const result = await deps.connectors.handleOpenWaWebhook({
      rawBody,
      signatureHeader: signature,
      payload: request.body,
    });
    for (const delivery of result.deliveries) {
      // Reply as the linked user so their own connector sends it.
      await withRequestActor({ employeeId: delivery.ownerEmployeeId }, () =>
        deps.desk.processInboundWhatsApp(delivery),
      ).catch(() => undefined);
    }
    return { ok: result.ok, accepted: result.accepted };
  });


  app.post<{ Body: OpenWaLinkStartRequest }>(
    "/v1/connectors/openwa/link/start",
    async (request) => deps.connectors.startOpenWaLink(request.body ?? {}),
  );


  app.get("/v1/connectors/openwa/link/status", async () => deps.connectors.getOpenWaLinkStatus());


  app.post("/v1/connectors/whatsapp/webhook", async (request) => {
    const rawBody =
      typeof (request as unknown as { rawBody?: string }).rawBody === "string"
        ? (request as unknown as { rawBody: string }).rawBody
        : JSON.stringify(request.body ?? {});
    const signature =
      typeof request.headers["x-hub-signature-256"] === "string"
        ? request.headers["x-hub-signature-256"]
        : undefined;
    const result = await deps.connectors.handleWhatsAppWebhook({
      rawBody,
      signatureHeader: signature,
      payload: request.body,
    });
    for (const message of extractWhatsAppInbound(request.body)) {
      await deps.desk
        .processInboundWhatsApp({
          from: message.from,
          text: message.text,
          messageId: message.id,
        })
        .catch(() => undefined);
    }
    return result;
  });


  app.post("/v1/connectors/finnhub/webhook", async (request) => {
    const secret =
      typeof request.headers["x-finnhub-secret"] === "string"
        ? request.headers["x-finnhub-secret"]
        : undefined;
    return deps.connectors.handleFinnhubWebhook({
      secretHeader: secret,
      payload: request.body,
    });
  });


  app.post<{ Params: { id: string }; Body: SendWhatsAppRequest }>(
    "/v1/connectors/:id/whatsapp/send",
    async (request) =>
      deps.connectors.sendWhatsApp(request.params.id, request.body ?? { to: "", text: "" }),
  );

  app.post<{
    Params: { id: string };
    Body: import("@arrab/shared").SendSlackRequest;
  }>("/v1/connectors/:id/slack/send", async (request) =>
    deps.connectors.sendSlack(request.params.id, request.body ?? { channelId: "", text: "" }),
  );

  app.get<{
    Params: { id: string };
    Querystring: { channelId?: string; q?: string; limit?: string };
  }>("/v1/connectors/:id/slack/mentions", async (request) => {
    const limit = Number(request.query.limit || "20");
    return deps.connectors.listSlackMentions(request.params.id, {
      channelId: request.query.channelId,
      query: request.query.q,
      limit: Number.isFinite(limit) ? limit : 20,
    });
  });


  app.get<{
    Params: { id: string };
    Querystring: { limit?: string };
  }>("/v1/connectors/:id/whatsapp/messages", async (request) => {
    const limit = Number(request.query.limit || "40");
    return deps.connectors.listWhatsAppMessages(
      request.params.id,
      Number.isFinite(limit) ? limit : 40,
    );
  });


  app.get<{
    Params: { owner: string; repo: string };
    Querystring: { connectorId: string };
  }>("/v1/github/repos/:owner/:repo", async (request) => {
    const connectorId = request.query.connectorId;
    if (!connectorId) {
      throw new ValidationError("connectorId is required");
    }
    return deps.connectors.githubRepoMeta(
      connectorId,
      request.params.owner,
      request.params.repo,
    );
  });

  app.get<{
    Params: { owner: string; repo: string };
    Querystring: { connectorId: string; ref?: string };
  }>("/v1/github/repos/:owner/:repo/tree", async (request) => {
    const connectorId = request.query.connectorId;
    if (!connectorId) {
      throw new ValidationError("connectorId is required");
    }
    return deps.connectors.githubTree(
      connectorId,
      request.params.owner,
      request.params.repo,
      request.query.ref,
    );
  });

  app.post<{
    Params: { owner: string; repo: string };
    Body: GithubCommitRequest;
  }>("/v1/github/repos/:owner/:repo/commits", async (request) =>
    deps.connectors.githubCommit(
      request.params.owner,
      request.params.repo,
      request.body ?? { connectorId: "", message: "", files: [] },
    ),
  );

  app.post<{
    Params: { owner: string; repo: string };
    Body: GithubCreatePullRequest;
  }>("/v1/github/repos/:owner/:repo/pulls", async (request) =>
    deps.connectors.githubPullRequest(
      request.params.owner,
      request.params.repo,
      request.body ?? { connectorId: "", title: "", head: "" },
    ),
  );
}
