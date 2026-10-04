/** Document Spaces — OpenDots-style page homes, Arrab-native. */

export type DocumentSpaceId = string;
export type SpacePageId = string;

export interface DocumentSpace {
  id: DocumentSpaceId;
  name: string;
  description: string;
  /** Companion ids allowed to read/write pages in this Space. */
  companionIds: string[];
  /** Default companion that receives “save here” from chat. */
  defaultCompanionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SpacePage {
  id: SpacePageId;
  spaceId: DocumentSpaceId;
  parentId: SpacePageId | null;
  title: string;
  /** Markdown body (source of truth). */
  markdown: string;
  /** Monotonic revision for optimistic concurrency. */
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface SpacesDocument {
  spaces: DocumentSpace[];
  pages: SpacePage[];
  updatedAt: string;
}

export interface SpacesView {
  spaces: DocumentSpace[];
  pages: SpacePage[];
  updatedAt: string;
}

export interface CreateDocumentSpaceRequest {
  name: string;
  description?: string;
  companionIds?: string[];
}

export interface UpdateDocumentSpaceRequest {
  name?: string;
  description?: string;
  companionIds?: string[];
  defaultCompanionId?: string | null;
}

export interface CreateSpacePageRequest {
  spaceId: string;
  parentId?: string | null;
  title: string;
  markdown?: string;
}

export interface UpdateSpacePageRequest {
  title?: string;
  markdown?: string;
  parentId?: string | null;
  /** Client must send the revision it loaded; mismatch → 409. */
  revision: number;
}

export interface ApproveSpacePageDraftRequest {
  spaceId: string;
  title: string;
  markdown: string;
  parentId?: string | null;
  companionId?: string | null;
}

export function emptySpacesDocument(now = new Date().toISOString()): SpacesDocument {
  return { spaces: [], pages: [], updatedAt: now };
}

export function normalizeSpacesDocument(raw: unknown): SpacesDocument {
  if (!raw || typeof raw !== "object") return emptySpacesDocument();
  const doc = raw as Partial<SpacesDocument>;
  const spaces = Array.isArray(doc.spaces)
    ? doc.spaces.filter((item): item is DocumentSpace => Boolean(item && typeof item === "object" && item.id && item.name))
    : [];
  const pages = Array.isArray(doc.pages)
    ? doc.pages.filter((item): item is SpacePage => Boolean(item && typeof item === "object" && item.id && item.spaceId))
    : [];
  return {
    spaces: spaces.map((space) => ({
      id: String(space.id),
      name: String(space.name ?? "").slice(0, 120),
      description: String(space.description ?? "").slice(0, 500),
      companionIds: Array.isArray(space.companionIds) ? space.companionIds.map(String) : [],
      defaultCompanionId: space.defaultCompanionId ? String(space.defaultCompanionId) : null,
      createdAt: String(space.createdAt ?? new Date().toISOString()),
      updatedAt: String(space.updatedAt ?? new Date().toISOString()),
    })),
    pages: pages.map((page) => ({
      id: String(page.id),
      spaceId: String(page.spaceId),
      parentId: page.parentId ? String(page.parentId) : null,
      title: String(page.title ?? "Untitled").slice(0, 200),
      markdown: String(page.markdown ?? "").slice(0, 200_000),
      revision: Math.max(1, Number(page.revision) || 1),
      createdAt: String(page.createdAt ?? new Date().toISOString()),
      updatedAt: String(page.updatedAt ?? new Date().toISOString()),
    })),
    updatedAt: String(doc.updatedAt ?? new Date().toISOString()),
  };
}
