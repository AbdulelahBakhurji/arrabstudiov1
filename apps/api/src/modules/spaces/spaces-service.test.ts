import { describe, expect, it } from "vitest";
import { createInMemoryPersistence } from "@arrab/database";
import { SpacesService } from "./spaces-service.js";

describe("SpacesService", () => {
  it("creates spaces and revision-safe pages", async () => {
    const persistence = createInMemoryPersistence("2026-01-01T00:00:00.000Z");
    const spaces = new SpacesService(persistence);

    const created = await spaces.createSpace({ name: "Launch" });
    expect(created.spaces).toHaveLength(1);
    const spaceId = created.spaces[0]!.id;

    const page = await spaces.createPage({
      spaceId,
      title: "Brief",
      markdown: "# Hello",
    });
    expect(page.page.revision).toBe(1);

    const updated = await spaces.updatePage(page.page.id, {
      markdown: "# Hello world",
      revision: 1,
    });
    expect(updated.page.revision).toBe(2);

    await expect(
      spaces.updatePage(page.page.id, { markdown: "stale", revision: 1 }),
    ).rejects.toThrow(/changed elsewhere/i);
  });

  it("approves a draft into a page", async () => {
    const persistence = createInMemoryPersistence("2026-01-01T00:00:00.000Z");
    const spaces = new SpacesService(persistence);
    const result = await spaces.approveDraft({
      spaceId: "",
      title: "From chat",
      markdown: "Draft body",
      companionId: "comp_1",
    });
    expect(result.page.title).toBe("From chat");
    expect(result.view.spaces.length).toBeGreaterThan(0);
  });
});
