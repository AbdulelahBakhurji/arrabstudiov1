/**
 * On-device Spaces store — works even when the production API has not
 * been redeployed with /v1/spaces yet. Optionally syncs to the API.
 */
import {
  emptySpacesDocument,
  normalizeSpacesDocument,
  type CreateDocumentSpaceRequest,
  type CreateSpacePageRequest,
  type DocumentSpace,
  type SpacePage,
  type SpacesDocument,
  type SpacesView,
  type UpdateDocumentSpaceRequest,
  type UpdateSpacePageRequest,
} from "@arrab/shared";
import { arrabApi } from "@/core/api/api";
import { ApiRequestError } from "@/core/api/http";
import { openLocalJson, sealLocalJson } from "@/core/storage/local-secure";

const STORAGE_KEY = "arrab.spaces.document.v1";

function nowIso(): string {
  return new Date().toISOString();
}

function id(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${hex}`;
}

async function readLocal(): Promise<SpacesDocument> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptySpacesDocument();
    const parsed = JSON.parse(raw) as unknown;
    return normalizeSpacesDocument(await openLocalJson(parsed));
  } catch {
    return emptySpacesDocument();
  }
}

async function writeLocal(doc: SpacesDocument): Promise<SpacesDocument> {
  const next = normalizeSpacesDocument({ ...doc, updatedAt: nowIso() });
  try {
    const sealed = await sealLocalJson(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sealed));
  } catch {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  return next;
}

function viewOf(doc: SpacesDocument): SpacesView {
  return { spaces: doc.spaces, pages: doc.pages, updatedAt: doc.updatedAt };
}

async function tryRemoteGet(): Promise<SpacesView | null> {
  try {
    return await arrabApi.spaces();
  } catch (err) {
    if (err instanceof ApiRequestError && (err.status === 404 || err.status === 501)) return null;
    return null;
  }
}

/** Merge remote into local when remote is newer or local is empty. */
async function mergeFromRemote(local: SpacesDocument, remote: SpacesView): Promise<SpacesDocument> {
  if (local.spaces.length === 0 && local.pages.length === 0 && remote.spaces.length > 0) {
    return writeLocal({
      spaces: remote.spaces,
      pages: remote.pages,
      updatedAt: remote.updatedAt,
    });
  }
  return local;
}

/** Pull remote in the background — never block the UI on /v1/spaces. */
function syncRemoteInBackground(): void {
  void (async () => {
    const remote = await tryRemoteGet();
    if (!remote) return;
    const local = await readLocal();
    await mergeFromRemote(local, remote);
  })();
}

export const localSpaces = {
  async get(): Promise<SpacesView> {
    const local = await readLocal();
    syncRemoteInBackground();
    return viewOf(local);
  },

  async createSpace(input: CreateDocumentSpaceRequest): Promise<SpacesView> {
    const name = input.name?.trim() ?? "";
    if (!name) throw new Error("Space name required");
    const stamp = nowIso();
    const space: DocumentSpace = {
      id: id("space"),
      name: name.slice(0, 120),
      description: (input.description ?? "").trim().slice(0, 500),
      companionIds: input.companionIds?.map(String) ?? [],
      defaultCompanionId: null,
      createdAt: stamp,
      updatedAt: stamp,
    };
    const doc = await readLocal();
    doc.spaces.unshift(space);
    const next = await writeLocal(doc);
    void arrabApi.createSpace({ name: space.name, description: space.description }).catch(() => undefined);
    return viewOf(next);
  },

  async updateSpace(spaceId: string, input: UpdateDocumentSpaceRequest): Promise<SpacesView> {
    const doc = await readLocal();
    const space = doc.spaces.find((item) => item.id === spaceId);
    if (!space) throw new Error("Space not found");
    if (input.name !== undefined) space.name = input.name.trim().slice(0, 120) || space.name;
    if (input.description !== undefined) space.description = input.description.trim().slice(0, 500);
    if (input.companionIds !== undefined) space.companionIds = input.companionIds.map(String);
    if (input.defaultCompanionId !== undefined) {
      space.defaultCompanionId = input.defaultCompanionId ? String(input.defaultCompanionId) : null;
    }
    space.updatedAt = nowIso();
    const next = await writeLocal(doc);
    void arrabApi.updateSpace(spaceId, input).catch(() => undefined);
    return viewOf(next);
  },

  async deleteSpace(spaceId: string): Promise<SpacesView> {
    const doc = await readLocal();
    doc.spaces = doc.spaces.filter((item) => item.id !== spaceId);
    doc.pages = doc.pages.filter((item) => item.spaceId !== spaceId);
    const next = await writeLocal(doc);
    void arrabApi.deleteSpace(spaceId).catch(() => undefined);
    return viewOf(next);
  },

  async createPage(input: CreateSpacePageRequest): Promise<{ view: SpacesView; page: SpacePage }> {
    const doc = await readLocal();
    const space = doc.spaces.find((item) => item.id === input.spaceId);
    if (!space) throw new Error("Space not found");
    const stamp = nowIso();
    const page: SpacePage = {
      id: id("page"),
      spaceId: space.id,
      parentId: input.parentId ?? null,
      title: (input.title?.trim() || "Untitled").slice(0, 200),
      markdown: (input.markdown ?? "").slice(0, 200_000),
      revision: 1,
      createdAt: stamp,
      updatedAt: stamp,
    };
    doc.pages.unshift(page);
    space.updatedAt = stamp;
    const next = await writeLocal(doc);
    void arrabApi.createSpacePage(input).catch(() => undefined);
    return { view: viewOf(next), page };
  },

  async updatePage(
    pageId: string,
    input: UpdateSpacePageRequest,
  ): Promise<{ view: SpacesView; page: SpacePage }> {
    const doc = await readLocal();
    const page = doc.pages.find((item) => item.id === pageId);
    if (!page) throw new Error("Page not found");
    if (input.revision !== page.revision) {
      throw new Error("This page changed elsewhere — reload and try again");
    }
    if (input.title !== undefined) page.title = (input.title.trim() || "Untitled").slice(0, 200);
    if (input.markdown !== undefined) page.markdown = input.markdown.slice(0, 200_000);
    if (input.parentId !== undefined) page.parentId = input.parentId;
    page.revision += 1;
    page.updatedAt = nowIso();
    const next = await writeLocal(doc);
    void arrabApi.updateSpacePage(pageId, input).catch(() => undefined);
    return { view: viewOf(next), page };
  },

  async deletePage(pageId: string): Promise<SpacesView> {
    const doc = await readLocal();
    const remove = new Set<string>([pageId]);
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
    const next = await writeLocal(doc);
    void arrabApi.deleteSpacePage(pageId).catch(() => undefined);
    return viewOf(next);
  },

  async approveDraft(input: {
    spaceId: string;
    title: string;
    markdown: string;
    companionId?: string | null;
  }): Promise<{ view: SpacesView; page: SpacePage }> {
    let spaceId = input.spaceId?.trim() ?? "";
    let doc = await readLocal();
    if (!spaceId) {
      if (doc.spaces.length === 0) {
        const created = await this.createSpace({
          name: "Inbox",
          description: "Pages saved from companion chat",
          companionIds: input.companionId ? [input.companionId] : [],
        });
        spaceId = created.spaces[0]!.id;
        doc = await readLocal();
      } else {
        spaceId = doc.spaces[0]!.id;
      }
    }
    return this.createPage({
      spaceId,
      title: input.title,
      markdown: input.markdown,
    });
  },
};
