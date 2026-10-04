import {
  NotFoundError,
  ValidationError,
  randomIdGenerator,
  systemClock,
  type Clock,
  type IdGenerator,
} from "@arrab/core";
import type { Persistence } from "@arrab/database";
import {
  normalizeSpacesDocument,
  type ApproveSpacePageDraftRequest,
  type CreateDocumentSpaceRequest,
  type CreateSpacePageRequest,
  type DocumentSpace,
  type SpacePage,
  type SpacesDocument,
  type SpacesView,
  type UpdateDocumentSpaceRequest,
  type UpdateSpacePageRequest,
} from "@arrab/shared";

export class SpacesService {
  constructor(
    private readonly persistence: Persistence,
    private readonly ids: IdGenerator = randomIdGenerator,
    private readonly clock: Clock = systemClock,
  ) {}

  async get(): Promise<SpacesView> {
    const doc = await this.load();
    return { spaces: doc.spaces, pages: doc.pages, updatedAt: doc.updatedAt };
  }

  async createSpace(input: CreateDocumentSpaceRequest): Promise<SpacesView> {
    const name = input.name?.trim() ?? "";
    if (name.length < 1 || name.length > 120) {
      throw new ValidationError("Give the Space a short name");
    }
    const now = this.clock.now().toISOString();
    const space: DocumentSpace = {
      id: this.ids.next("space"),
      name,
      description: (input.description ?? "").trim().slice(0, 500),
      companionIds: Array.isArray(input.companionIds) ? input.companionIds.map(String) : [],
      defaultCompanionId: null,
      createdAt: now,
      updatedAt: now,
    };
    const doc = await this.load();
    doc.spaces.unshift(space);
    doc.updatedAt = now;
    await this.save(doc);
    return this.view(doc);
  }

  async updateSpace(id: string, input: UpdateDocumentSpaceRequest): Promise<SpacesView> {
    const doc = await this.load();
    const space = doc.spaces.find((item) => item.id === id);
    if (!space) throw new NotFoundError("Space not found");
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (name.length < 1 || name.length > 120) throw new ValidationError("Give the Space a short name");
      space.name = name;
    }
    if (input.description !== undefined) space.description = input.description.trim().slice(0, 500);
    if (input.companionIds !== undefined) space.companionIds = input.companionIds.map(String);
    if (input.defaultCompanionId !== undefined) {
      space.defaultCompanionId = input.defaultCompanionId ? String(input.defaultCompanionId) : null;
    }
    space.updatedAt = this.clock.now().toISOString();
    doc.updatedAt = space.updatedAt;
    await this.save(doc);
    return this.view(doc);
  }

  async deleteSpace(id: string): Promise<SpacesView> {
    const doc = await this.load();
    if (!doc.spaces.some((item) => item.id === id)) throw new NotFoundError("Space not found");
    doc.spaces = doc.spaces.filter((item) => item.id !== id);
    doc.pages = doc.pages.filter((item) => item.spaceId !== id);
    doc.updatedAt = this.clock.now().toISOString();
    await this.save(doc);
    return this.view(doc);
  }

  async createPage(input: CreateSpacePageRequest): Promise<{ view: SpacesView; page: SpacePage }> {
    const doc = await this.load();
    const space = doc.spaces.find((item) => item.id === input.spaceId);
    if (!space) throw new NotFoundError("Space not found");
    const title = (input.title ?? "").trim() || "Untitled";
    if (title.length > 200) throw new ValidationError("Title is too long");
    if (input.parentId) {
      const parent = doc.pages.find((item) => item.id === input.parentId && item.spaceId === space.id);
      if (!parent) throw new NotFoundError("Parent page not found");
    }
    const now = this.clock.now().toISOString();
    const page: SpacePage = {
      id: this.ids.next("page"),
      spaceId: space.id,
      parentId: input.parentId ?? null,
      title: title.slice(0, 200),
      markdown: (input.markdown ?? "").slice(0, 200_000),
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    doc.pages.unshift(page);
    space.updatedAt = now;
    doc.updatedAt = now;
    await this.save(doc);
    return { view: this.view(doc), page };
  }

  async updatePage(id: string, input: UpdateSpacePageRequest): Promise<{ view: SpacesView; page: SpacePage }> {
    const doc = await this.load();
    const page = doc.pages.find((item) => item.id === id);
    if (!page) throw new NotFoundError("Page not found");
    if (input.revision !== page.revision) {
      throw new ValidationError("This page changed elsewhere — reload and try again");
    }
    if (input.title !== undefined) {
      const title = input.title.trim() || "Untitled";
      if (title.length > 200) throw new ValidationError("Title is too long");
      page.title = title;
    }
    if (input.markdown !== undefined) page.markdown = input.markdown.slice(0, 200_000);
    if (input.parentId !== undefined) {
      if (input.parentId) {
        const parent = doc.pages.find((item) => item.id === input.parentId && item.spaceId === page.spaceId);
        if (!parent) throw new NotFoundError("Parent page not found");
        if (parent.id === page.id) throw new ValidationError("A page cannot be its own parent");
      }
      page.parentId = input.parentId;
    }
    page.revision += 1;
    page.updatedAt = this.clock.now().toISOString();
    doc.updatedAt = page.updatedAt;
    const space = doc.spaces.find((item) => item.id === page.spaceId);
    if (space) space.updatedAt = page.updatedAt;
    await this.save(doc);
    return { view: this.view(doc), page };
  }

  async deletePage(id: string): Promise<SpacesView> {
    const doc = await this.load();
    if (!doc.pages.some((item) => item.id === id)) throw new NotFoundError("Page not found");
    const remove = new Set<string>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const page of doc.pages) {
        if (page.parentId && remove.has(page.parentId) && !remove.has(page.id)) {
          remove.add(page.id);
          grew = true;
        }
      }
    }
    doc.pages = doc.pages.filter((item) => !remove.has(item.id));
    doc.updatedAt = this.clock.now().toISOString();
    await this.save(doc);
    return this.view(doc);
  }

  async search(query: string): Promise<{ pages: SpacePage[] }> {
    const q = query.trim().toLowerCase();
    const doc = await this.load();
    if (!q) return { pages: doc.pages.slice(0, 40) };
    return {
      pages: doc.pages
        .filter(
          (page) =>
            page.title.toLowerCase().includes(q) || page.markdown.toLowerCase().includes(q),
        )
        .slice(0, 40),
    };
  }

  /** HITL approve: create page from a companion draft. */
  async approveDraft(input: ApproveSpacePageDraftRequest): Promise<{ view: SpacesView; page: SpacePage }> {
    let spaceId = input.spaceId?.trim() ?? "";
    const doc = await this.load();
    if (!spaceId) {
      const preferred = input.companionId
        ? doc.spaces.find((space) => space.defaultCompanionId === input.companionId)
        : null;
      spaceId = preferred?.id ?? doc.spaces[0]?.id ?? "";
    }
    if (!spaceId) {
      const created = await this.createSpace({
        name: "Inbox",
        description: "Pages saved from companion chat",
        companionIds: input.companionId ? [input.companionId] : [],
      });
      spaceId = created.spaces[0]!.id;
    }
    return this.createPage({
      spaceId,
      parentId: input.parentId ?? null,
      title: input.title,
      markdown: input.markdown,
    });
  }

  private async load(): Promise<SpacesDocument> {
    return normalizeSpacesDocument(await this.persistence.documentSpaces.get());
  }

  private async save(doc: SpacesDocument): Promise<void> {
    await this.persistence.documentSpaces.save(normalizeSpacesDocument(doc));
  }

  private view(doc: SpacesDocument): SpacesView {
    return { spaces: doc.spaces, pages: doc.pages, updatedAt: doc.updatedAt };
  }
}
