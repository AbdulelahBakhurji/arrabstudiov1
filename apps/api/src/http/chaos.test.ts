import { describe, expect, it } from "vitest";
import { bootWorld } from "../test-support/world.js";

describe("infrastructure failure", () => {
  it("a database outage is a clean 5xx that leaks nothing, and the API recovers by itself", async () => {
    const w = await bootWorld({ plan: "solo", seats: false });
    try {
      const real = w.context.persistence.accounts.get.bind(w.context.persistence.accounts);
      let down = true;
      w.context.persistence.accounts.get = async () => {
        if (down)
          throw new Error("connect ECONNREFUSED postgres://admin:s3cr3t-pw@db.internal:5432/arrab");
        return real();
      };
      const res = await w.app.inject({
        method: "GET",
        url: "/v1/account",
        headers: { authorization: `Bearer ${w.ownerToken}` },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(500);
      expect(res.statusCode).toBeLessThan(600);
      expect(res.body).not.toMatch(/s3cr3t|postgres:\/\/|ECONNREFUSED|db\.internal|\bat \w+.*\.ts/);
      expect(res.json().error.code).toBeTruthy();

      // A health probe must still answer (the process is alive), and the outage must not wedge anything.
      expect((await w.app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
      down = false;
      expect((await w.as.owner("GET", "/v1/account")).status).toBe(200);
    } finally {
      await w.close();
    }
  });

  it("a write that fails halfway does not leave the user charged or half-created", async () => {
    const w = await bootWorld({ plan: "solo", seats: false });
    try {
      const failing = w.context.persistence.agents.create.bind(w.context.persistence.agents);
      w.context.persistence.agents.create = async () => {
        throw new Error("disk full");
      };
      expect((await w.as.owner("POST", "/v1/agents", { name: "A", role: "r" })).status).toBe(500);
      w.context.persistence.agents.create = failing;
      expect((await w.as.owner("GET", "/v1/agents")).body.items).toEqual([]);
      expect((await w.as.owner("POST", "/v1/agents", { name: "A", role: "r" })).status).toBe(200);
    } finally {
      await w.close();
    }
  });

  it("duplicate submissions (double click / retry) create one record, not two", async () => {
    const w = await bootWorld({ plan: "solo", seats: false });
    try {
      const body = { name: "Once", role: "r", clientKey: "companion:abc:work" };
      const results = await Promise.all(
        [1, 2, 3, 4, 5].map(() => w.as.owner("POST", "/v1/agents", body)),
      );
      expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
      expect((await w.as.owner("GET", "/v1/agents")).body.items).toHaveLength(1);
    } finally {
      await w.close();
    }
  });

  it("an expired session mid-stream-sized workflow fails closed, not open", async () => {
    const w = await bootWorld({ plan: "solo", seats: false });
    try {
      const account = (await w.context.persistence.accounts.get())!;
      await w.context.persistence.accounts.upsert({
        ...account,
        sessions: account.sessions!.map((s) => ({ ...s, expiresAt: "2000-01-01T00:00:00.000Z" })),
      });
      for (const [m, u] of [
        ["GET", "/v1/account"],
        ["POST", "/v1/agents"],
        ["GET", "/v1/conversations"],
        ["POST", "/v1/sync/push"],
      ] as const) {
        expect((await w.as.owner(m, u, m === "POST" ? {} : undefined)).status, `${m} ${u}`).toBe(
          401,
        );
      }
    } finally {
      await w.close();
    }
  });
});
