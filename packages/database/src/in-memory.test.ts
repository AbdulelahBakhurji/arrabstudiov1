import { describe, expect, it } from "vitest";
import { createInMemoryPersistence } from "./in-memory.js";
import { LOCAL_WORKSPACE_ID } from "./types.js";

describe("createInMemoryPersistence", () => {
  it("boots a local workspace with empty collections", async () => {
    const persistence = createInMemoryPersistence("2026-01-01T00:00:00.000Z");
    expect(persistence.kind).toBe("memory");
    expect(persistence.workspaceId).toBe(LOCAL_WORKSPACE_ID);
    const workspace = await persistence.getWorkspace();
    expect(workspace.workspace.name).toBe("Local studio");
    expect(await persistence.projects.list()).toEqual([]);
    expect(await persistence.agents.list()).toEqual([]);
    expect(await persistence.teams.list()).toEqual([]);
    expect(await persistence.activity.list()).toEqual([]);
    expect(await persistence.memberships.list()).toEqual([]);
    expect(await persistence.connectors.list()).toEqual([]);
    expect(await persistence.bindings.list()).toEqual([]);
    expect(await persistence.usage.listAll()).toEqual([]);
  });

  it("stores created projects", async () => {
    const persistence = createInMemoryPersistence("2026-01-01T00:00:00.000Z");
    await persistence.projects.create({
      id: "prj_1" as never,
      workspaceId: persistence.workspaceId,
      name: "Launch",
      description: null,
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const items = await persistence.projects.list();
    expect(items).toHaveLength(1);
    expect(items[0]?.name).toBe("Launch");
  });
});
