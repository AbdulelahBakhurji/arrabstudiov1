import { createInMemoryPersistence } from "@arrab/database";
import { brandId, type ConnectorSecretRecord, type WorkspaceId } from "@arrab/shared";
import { describe, expect, it } from "vitest";
import { withRequestActor } from "../../platform/context/request-actor.js";
import { ConnectorService } from "./connector-service.js";

function row(id: string, ownerEmployeeId: string | null): ConnectorSecretRecord {
  return {
    id,
    workspaceId: brandId<WorkspaceId>("ws_local_studio"),
    provider: "notion",
    status: "connected",
    accountLabel: id,
    scopes: [],
    connectedAt: "2026-01-01T00:00:00.000Z",
    lastVerifiedAt: null,
    error: null,
    secret: "token",
    familyMemberId: null,
    ownerEmployeeId,
  };
}

const as = <T>(employeeId: string | null, fn: () => Promise<T>) =>
  withRequestActor({ employeeId }, fn);

describe("per-user connectors", () => {
  async function setup() {
    const persistence = createInMemoryPersistence("2026-01-01T00:00:00.000Z");
    await persistence.connectors.create(row("owner-notion", null));
    await persistence.connectors.create(row("ana-notion", "emp-ana"));
    await persistence.connectors.create(row("ben-notion", "emp-ben"));
    return { persistence, service: new ConnectorService(persistence) };
  }

  it("shows each user only their own connectors", async () => {
    const { service } = await setup();
    const ids = async (employeeId: string | null) =>
      (await as(employeeId, () => service.list())).map((c) => c.id);
    expect(await ids("emp-ana")).toEqual(["ana-notion"]);
    expect(await ids("emp-ben")).toEqual(["ben-notion"]);
    expect(await ids(null)).toEqual(["owner-notion"]);
  });

  it("blocks reading another user's connector by id", async () => {
    const { service } = await setup();
    await expect(as("emp-ben", () => service.verify("ana-notion"))).rejects.toThrow(/another user/);
    await expect(as("emp-ben", () => service.disconnect("ana-notion"))).rejects.toThrow(/another user/);
  });

  it("signing out removes only the signed-out user's connectors", async () => {
    const { service, persistence } = await setup();
    const result = await as("emp-ana", () => service.signOutCurrentUser());
    expect(result.removed).toBe(1);
    const left = (await persistence.connectors.list()).map((c) => c.id).sort();
    expect(left).toEqual(["ben-notion", "owner-notion"]);
  });
});
