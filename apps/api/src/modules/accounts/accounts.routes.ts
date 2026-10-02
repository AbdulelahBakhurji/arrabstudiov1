import type { ChangePasswordRequest, ActivateSubscriptionRequest, ConnectAccountRequest, SignInAccountRequest, StartWebAuthRequest, CompleteWebAuthRequest, VerifyAccountSessionRequest, UpdateAccountProfileRequest } from "@arrab/shared";
import { escapeHtml } from "../../platform/http/html-safe.js";
import { ForbiddenError } from "@arrab/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { SessionMeta } from "./account-service.js";
import type { RouteHelpers, V1Deps } from "../../http/deps.js";

/** Device label sent by the client (headers are advisory: they only name the device in the user's own device list). */
function sessionMeta(request: FastifyRequest): SessionMeta {
  const header = (name: string) => {
    const value = request.headers[name];
    return (Array.isArray(value) ? value[0] : value) ?? undefined;
  };
  return {
    deviceName: header("x-arrab-device-name"),
    platform: header("x-arrab-platform"),
    appVersion: header("x-arrab-app-version"),
    // Opt in to short-lived access tokens + refresh rotation.
    refresh: header("x-arrab-refresh") === "1",
  };
}

export function registerAccountsRoutes(app: FastifyInstance, deps: V1Deps, { assertCap, assertOwnerSession }: RouteHelpers): void {
  app.get("/v1/account", async (request) => {
    const status = request.account
      ? await deps.accounts.statusFor(request.account)
      : await deps.accounts.status();
    const employee = request.orgEmployee ?? null;
    if (employee && !deps.orgWorkforce.permissionsFor(employee).canAdminister) {
      return {
        ...status,
        plans: [],
        entitlements: status.entitlements
          ? {
              ...status.entitlements,
              tokensUsed: 0,
              tokensRemaining: status.entitlements.tokenLimit,
              overLimit: false,
              planName: "Seat",
              planId: status.entitlements.planId,
            }
          : status.entitlements,
      };
    }
    return status;
  });

  app.post<{ Body: ConnectAccountRequest }>("/v1/account/connect", async (request) => {
    const result = await deps.accounts.connect(request.body ?? { email: "", password: "" }, sessionMeta(request));
    await deps.familyHousehold.clearSeatLock();
    return result;
  });

  app.post<{ Body: SignInAccountRequest }>("/v1/account/sign-in", async (request) => {
    const result = await deps.accounts.signIn(request.body ?? { email: "", password: "" }, sessionMeta(request));
    await deps.familyHousehold.clearSeatLock();
    return result;
  });

  app.post<{ Body: VerifyAccountSessionRequest }>("/v1/account/session", async (request) =>
    deps.accounts.verifySession(request.body?.sessionToken ?? ""),
  );

  /** Rotate the session: refresh token in, new access + refresh token out. Public (the access token is expired by definition). */
  app.post<{ Body: { refreshToken?: string } }>("/v1/account/refresh", async (request) =>
    deps.accounts.refreshSession(request.body?.refreshToken ?? ""),
  );

  app.post<{ Body: ChangePasswordRequest }>("/v1/account/password", async (request) => {
    assertOwnerSession(request, "Only the account owner can change the password");
    return deps.accounts.changePassword(request.body ?? { currentPassword: "", newPassword: "" }, request.sessionId);
  });

  app.post("/v1/account/disconnect", async (request) => {
    assertOwnerSession(request, "Only the account owner can remove the account");
    await deps.familyHousehold.clearSeatLock();
    return deps.accounts.disconnect();
  });

  app.post("/v1/account/logout", async (request) => {
    // Only a real device session can sign itself out. A request that carries no session of its own
    // (an org employee, an anonymous caller) must never be able to end the owner's sessions.
    if (!request.sessionId) throw new ForbiddenError("No session to sign out");
    // Only this device signs out. The user's connectors and household lock are cleared when the
    // last device leaves, so signing out on a phone does not break the Mac.
    const { status, remainingSessions } = await deps.accounts.logout(request.sessionId);
    // A family seat leaving never wipes the household's connectors; only the owner's last device does.
    if (remainingSessions === 0 && !request.seatMemberId) {
      await deps.connectors.signOutCurrentUser();
      await deps.familyHousehold.clearSeatLock();
    }
    return status;
  });

  app.get("/v1/account/sessions", async (request) => {
    assertOwnerSession(request, "Only the account owner can see signed-in devices");
    return { sessions: await deps.accounts.listSessions(request.sessionId) };
  });

  app.delete<{ Params: { id: string } }>("/v1/account/sessions/:id", async (request) => {
    assertOwnerSession(request, "Only the account owner can sign devices out");
    const remaining = await deps.accounts.revokeSession(request.params.id);
    if (remaining === 0) {
      await deps.connectors.signOutCurrentUser();
      await deps.familyHousehold.clearSeatLock();
    }
    return { sessions: await deps.accounts.listSessions(request.sessionId) };
  });

  /** "Sign out everywhere" (keeps this device unless `includeCurrent` is true). */
  app.post<{ Body: { includeCurrent?: boolean } }>("/v1/account/sessions/revoke-all", async (request) => {
    assertOwnerSession(request, "Only the account owner can sign devices out");
    const keep = request.body?.includeCurrent ? null : request.sessionId;
    const remaining = await deps.accounts.revokeAllSessions(keep);
    if (remaining === 0) {
      await deps.connectors.signOutCurrentUser();
      await deps.familyHousehold.clearSeatLock();
    }
    return { sessions: await deps.accounts.listSessions(request.sessionId) };
  });

  app.post<{ Body: ActivateSubscriptionRequest }>("/v1/account/subscribe", async (request) => {
    assertOwnerSession(request, "Only the account owner can change the plan");
    await assertCap(request, "canAdminister", "Only admins can change organization plans");
    return deps.accounts.activateSubscription(request.body ?? { code: "" });
  });

  app.patch<{ Body: UpdateAccountProfileRequest }>("/v1/account", async (request) => {
    assertOwnerSession(request, "Only the account owner can edit the account");
    return deps.accounts.updateProfile(request.body ?? {});
  });


  app.post<{ Body: StartWebAuthRequest }>("/v1/account/auth/web/start", async (request) =>
    deps.accounts.startWebAuth(sessionMeta(request)),
  );

  app.get<{ Querystring: { state?: string; pollSecret?: string } }>(
    "/v1/account/auth/web/poll",
    async (request) =>
      deps.accounts.pollWebAuth(request.query.state ?? "", request.query.pollSecret ?? ""),
  );

  app.post<{ Body: CompleteWebAuthRequest }>("/v1/account/auth/web/complete", async (request) => {
    const result = await deps.accounts.completeWebAuth(
      request.body ?? { state: "", email: "", password: "" },
    );
    await deps.familyHousehold.clearSeatLock();
    return result;
  });


  app.get<{ Querystring: { state?: string } }>("/v1/account/auth/web", async (request, reply) => {
    const state = request.query.state ?? "";
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Arrab Studio · Sign in</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: ui-sans-serif, system-ui, sans-serif; background: #050505; color: #f5f5f5; }
    .card { width: min(420px, calc(100vw - 2rem)); border: 1px solid rgba(255,255,255,.12); border-radius: 24px; background: #0a0a0a; padding: 28px; }
    h1 { margin: 0; font-size: 1.35rem; font-weight: 560; letter-spacing: -0.03em; }
    p { color: #a3a3a3; font-size: .9rem; line-height: 1.5; }
    label { display: grid; gap: 6px; margin-top: 14px; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: #737373; }
    input { width: 100%; box-sizing: border-box; border-radius: 12px; border: 1px solid rgba(255,255,255,.14); background: #000; color: #fff; padding: 12px 14px; font-size: 14px; }
    button { margin-top: 18px; width: 100%; border: 0; border-radius: 999px; background: #fff; color: #000; font-weight: 600; padding: 12px 16px; cursor: pointer; }
    a.open { display: inline-block; margin-top: 12px; color: #bbf7d0; }
    .ok { color: #bbf7d0; } .err { color: #fecaca; }
  </style>
</head>
<body>
  <form class="card" id="form">
    <h1>Sign in to Arrab Studio</h1>
    <p>Complete sign-in here. When it succeeds, Arrab Studio opens automatically.</p>
    <input type="hidden" name="state" value="${escapeHtml(state)}" />
    <label>Display name<input name="displayName" placeholder="Your name" /></label>
    <label>Email<input name="email" type="email" required placeholder="you@company.com" /></label>
    <label>Password<input name="password" type="password" required minlength="8" placeholder="At least 8 characters" /></label>
    <label>Plan code (optional)<input name="planCode" placeholder="PRO-ARRAB" /></label>
    <button type="submit">Sign in</button>
    <p id="msg"></p>
    <a class="open" id="openApp" href="arrab://auth/complete" hidden>Open Arrab Studio</a>
  </form>
  <script>
    const form = document.getElementById('form');
    const msg = document.getElementById('msg');
    const openApp = document.getElementById('openApp');
    function openStudio(sessionToken) {
      const state = (form.querySelector('input[name="state"]') || {}).value || '';
      const params = new URLSearchParams();
      if (sessionToken) params.set('session', sessionToken);
      if (state) params.set('state', state);
      const href = params.toString()
        ? ('arrab://auth/complete?' + params.toString())
        : 'arrab://auth/complete';
      openApp.href = href;
      openApp.hidden = false;
      window.location.href = href;
    }
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      msg.textContent = 'Signing in…';
      msg.className = '';
      const data = Object.fromEntries(new FormData(form).entries());
      try {
        const response = await fetch('/v1/account/auth/web/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(data),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error?.message || 'Sign-in failed');
        msg.className = 'ok';
        msg.textContent = 'Signed in as ' + payload.account.email + '. Opening Arrab Studio…';
        form.querySelector('button').disabled = true;
        openStudio(payload.sessionToken || '');
      } catch (error) {
        msg.className = 'err';
        msg.textContent = error instanceof Error ? error.message : 'Sign-in failed';
      }
    });
  </script>
</body>
</html>`;
    return reply.type("text/html").send(html);
  });
}
