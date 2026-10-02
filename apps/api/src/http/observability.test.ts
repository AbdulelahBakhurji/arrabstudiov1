import { describe, expect, it } from "vitest";
import { buildApp, createApiContext } from "../app.js";
import { makeTestEnv } from "../test-support/env.js";
import { bootWorld, startChat } from "../test-support/world.js";

describe("request ids and correlation", () => {
  it("every response carries an id; a well-formed caller id is kept end to end", async () => {
    const w = await bootWorld({ plan: "solo", seats: false });
    try {
      const generated = await w.app.inject({ method: "GET", url: "/health" });
      expect(generated.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
      const kept = await w.app.inject({ method: "GET", url: "/health", headers: { "x-request-id": "desktop-1234abcd" } });
      expect(kept.headers["x-request-id"]).toBe("desktop-1234abcd");
    } finally {
      await w.close();
    }
  });

  it("a hostile caller-supplied id is replaced (it would otherwise reach logs and headers)", async () => {
    const w = await bootWorld({ plan: "solo", seats: false });
    try {
      for (const bad of ["x", "a b c d e f g h", "id\u0000injected", "a".repeat(200), "<script>alert(1)</script>"]) {
        const res = await w.app.inject({ method: "GET", url: "/health", headers: { "x-request-id": bad } });
        expect(res.headers["x-request-id"], bad.slice(0, 20)).toMatch(/^[0-9a-f-]{36}$/);
      }
    } finally {
      await w.close();
    }
  });

  it("errors carry the same id so a user-visible failure can be found in the logs", async () => {
    const w = await bootWorld({ plan: "solo", seats: false });
    try {
      const res = await w.app.inject({ method: "GET", url: "/v1/account", headers: { "x-request-id": "support-ticket-42" } });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.requestId).toBe("support-ticket-42");
      expect(res.headers["x-request-id"]).toBe("support-ticket-42");
    } finally {
      await w.close();
    }
  });

  it("rate-limit answers tell the client when to retry", async () => {
    const w = await bootWorld({ plan: "solo", seats: false });
    try {
      let res = await w.app.inject({ method: "POST", url: "/v1/account/sign-in", payload: { email: "a@b.co", password: "wrongwrong" } });
      for (let i = 0; i < 40 && res.statusCode !== 429; i++) res = await w.app.inject({ method: "POST", url: "/v1/account/sign-in", payload: { email: "a@b.co", password: "wrongwrong" } });
      expect(res.statusCode).toBe(429);
      expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
    } finally {
      await w.close();
    }
  });
});

describe("logs never contain credentials", () => {
  it("authorization and session headers are redacted in structured logs", async () => {
    const lines: string[] = [];
    const context = await createApiContext(makeTestEnv({ logLevel: "info", logStream: { write: (c: string) => void lines.push(c) } }));
    const app = await buildApp(context);
    const connect = await app.inject({ method: "POST", url: "/v1/account/connect", payload: { email: "o@arrab.test", password: "securepass" } });
    const token = connect.json().sessionToken as string;
    await app.inject({ method: "GET", url: "/v1/account", headers: { authorization: `Bearer ${token}`, "x-arrab-account-session": token, "x-arrab-employee-session": "employee-secret-token-value", "x-request-id": "trace-me-0001" } });
    await app.close();
    const text = lines.join("");
    expect(text).toContain("trace-me-0001"); // the correlation id is logged…
    expect(text).not.toContain(token); // …the credentials are not
    expect(text).not.toContain("employee-secret-token-value");
    expect(text).not.toContain("securepass");
  });
});

describe("metrics", () => {
  it("are off unless a token is configured, and protected when on", async () => {
    const off = await bootWorld({ plan: "solo", seats: false });
    expect((await off.app.inject({ method: "GET", url: "/metrics" })).statusCode).toBe(404);
    await off.close();

    const on = await bootWorld({ plan: "solo", seats: false, env: { metricsToken: "scrape-token-1234567890" } });
    try {
      expect((await on.app.inject({ method: "GET", url: "/metrics" })).statusCode).toBe(401);
      expect((await on.app.inject({ method: "GET", url: "/metrics", headers: { authorization: "Bearer wrong" } })).statusCode).toBe(401);
      // A studio session is not a scrape credential.
      expect((await on.app.inject({ method: "GET", url: "/metrics", headers: { authorization: `Bearer ${on.ownerToken}` } })).statusCode).toBe(401);
      await on.as.owner("GET", "/v1/agents");
      const res = await on.app.inject({ method: "GET", url: "/metrics", headers: { authorization: "Bearer scrape-token-1234567890" } });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('arrab_http_requests_total{method="GET",route="/v1/agents",status="2xx"}');
      expect(res.body).toMatch(/arrab_http_request_duration_ms_bucket\{method="GET",route="\/v1\/agents",le="\+Inf"\} \d+/);
      // Labels are route patterns, never ids, tokens or users.
      expect(res.body).not.toContain(on.ownerToken);
      expect(res.body).not.toMatch(/owner\d+@/);
    } finally {
      await on.close();
    }
  });

  it("records arrab_ai_* series for a successful chat completion", async () => {
    const w = await bootWorld({
      plan: "solo",
      seats: false,
      env: { metricsToken: "scrape-token-ai-metrics" },
    });
    try {
      const chat = await startChat(w.as.owner);
      expect((await chat.send("hi")).status).toBe(200);
      const res = await w.app.inject({
        method: "GET",
        url: "/metrics",
        headers: { authorization: "Bearer scrape-token-ai-metrics" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toMatch(/arrab_ai_requests_total\{.*outcome="success".*\}/);
      expect(res.body).toMatch(/arrab_ai_request_duration_ms_count\{/);
      expect(res.body).toMatch(/arrab_ai_tokens_total\{.*direction="input".*\}/);
      expect(res.body).not.toContain(w.ownerToken);
    } finally {
      await w.close();
    }
  });

  it("readiness reflects the database, liveness does not", async () => {
    const w = await bootWorld({ plan: "solo", seats: false });
    try {
      expect((await w.app.inject({ method: "GET", url: "/ready" })).json()).toEqual({ status: "ready" });
      const real = w.context.persistence.getWorkspace.bind(w.context.persistence);
      w.context.persistence.getWorkspace = async () => {
        throw new Error("db down");
      };
      const down = await w.app.inject({ method: "GET", url: "/ready" });
      expect(down.statusCode).toBe(503);
      expect(down.body).not.toContain("db down");
      expect((await w.app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
      w.context.persistence.getWorkspace = real;
    } finally {
      await w.close();
    }
  });
});

it("chat traffic shows up in metrics by route pattern", async () => {
  const w = await bootWorld({ plan: "solo", seats: false });
  try {
    const chat = await startChat(w.as.owner);
    await chat.send("hi");
    expect(w.context.metrics.counter("arrab_http_requests_total", { route: "/v1/conversations/:id/messages", method: "POST", status: "2xx" })).toBe(1);
  } finally {
    await w.close();
  }
});
