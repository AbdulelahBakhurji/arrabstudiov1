/**
 * Runs the real migrations and SQL against Postgres. Skipped unless ARRAB_TEST_DATABASE_URL is set:
 *   docker run -d --rm -e POSTGRES_PASSWORD=test -e POSTGRES_DB=arrab -p 55432:5432 postgres:16-alpine
 *   ARRAB_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/arrab pnpm test
 */
import { describe, expect, it } from "vitest";
import { buildApp, createApiContext } from "../../app.js";
import { makeTestEnv } from "../../test-support/env.js";

const url = process.env.ARRAB_TEST_DATABASE_URL;

describe.skipIf(!url)("postgres: migrations, sessions, sync", () => {
  it("applies every migration and serves device sessions + revisioned sync from SQL", async () => {
    const context = await createApiContext(
      makeTestEnv({ databaseUrl: url, dataEncryptionKey: "a".repeat(64) }),
    );
    // Start from a clean workspace so the test is repeatable.
    await context.persistence.accounts.delete();
    await context.sync.purgeAll();
    const app = await buildApp(context);

    const connect = await app.inject({
      method: "POST",
      url: "/v1/account/connect",
      headers: { "x-arrab-platform": "macos", "x-arrab-device-name": "Mac" },
      payload: { email: "pg@arrab.studio", password: "securepass" },
    });
    expect(connect.statusCode).toBe(200);
    const mac = (connect.json() as { sessionToken: string }).sessionToken;
    const phone = (
      await app.inject({
        method: "POST",
        url: "/v1/account/sign-in",
        headers: { "x-arrab-platform": "ios", "x-arrab-device-name": "iPhone" },
        payload: { email: "pg@arrab.studio", password: "securepass" },
      })
    ).json().sessionToken as string;

    const as = (token: string) => ({ authorization: `Bearer ${token}` });
    const sessions = (
      await app.inject({ method: "GET", url: "/v1/account/sessions", headers: as(mac) })
    ).json().sessions;
    expect(sessions.map((s: { platform: string }) => s.platform).sort()).toEqual(["ios", "macos"]);

    const push = (token: string, ops: unknown[]) =>
      app.inject({ method: "POST", url: "/v1/sync/push", headers: as(token), payload: { ops } });
    const op = (opId: string, baseRev: number, patch: Record<string, unknown>) => ({
      opId,
      type: "upsert",
      kind: "project",
      id: "pg-proj-1",
      baseRev,
      patch,
    });

    expect(
      (await push(mac, [op("pg-op-seed-1", 0, { title: "A" })])).json().results[0].record.rev,
    ).toBe(1);
    // Two devices write on rev 1 at the same moment: exactly one wins, the other gets a conflict.
    const [a, b] = await Promise.all([
      push(mac, [op("pg-op-mac-01", 1, { notes: "mac" })]),
      push(phone, [op("pg-op-phn-01", 1, { notes: "phone" })]),
    ]);
    const statuses = [a, b].map((r) => r.json().results[0].status).sort();
    expect(statuses).toEqual(["conflict", "ok"]);

    // A retry of an op that was already applied is a no-op that answers with the record as it is now.
    const retry = await push(mac, [op("pg-op-seed-1", 0, { title: "A" })]);
    expect(retry.json().results[0]).toMatchObject({ status: "ok", record: { rev: 2 } });

    const pulled = (
      await app.inject({ method: "GET", url: "/v1/sync/pull", headers: as(phone) })
    ).json();
    expect(pulled.records).toHaveLength(1);
    expect(pulled.records[0].rev).toBe(2);

    // Revoking the phone takes effect immediately.
    const phoneId = sessions.find((s: { platform: string }) => s.platform === "ios").id;
    await app.inject({
      method: "DELETE",
      url: `/v1/account/sessions/${phoneId}`,
      headers: as(mac),
    });
    expect(
      (await app.inject({ method: "GET", url: "/v1/account", headers: as(phone) })).statusCode,
    ).toBe(401);

    await context.persistence.accounts.delete();
    await context.sync.purgeAll();
    await app.close();
    await context.postgres?.close();
  });
});
