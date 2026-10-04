import type {
  ApproveSpacePageDraftRequest,
  CreateDocumentSpaceRequest,
  CreateSpacePageRequest,
  SpacePage,
  SpacesView,
  UpdateDocumentSpaceRequest,
  UpdateSpacePageRequest,
} from "@arrab/shared";
import { request } from "@/core/api/http";

export const spacesApi = {
  spaces: () => request<SpacesView>("/v1/spaces"),
  createSpace: (body: CreateDocumentSpaceRequest) =>
    request<SpacesView>("/v1/spaces", { method: "POST", body }),
  updateSpace: (id: string, body: UpdateDocumentSpaceRequest) =>
    request<SpacesView>(`/v1/spaces/${encodeURIComponent(id)}`, { method: "PATCH", body }),
  deleteSpace: (id: string) =>
    request<SpacesView>(`/v1/spaces/${encodeURIComponent(id)}`, { method: "DELETE" }),
  searchSpacePages: (q: string) =>
    request<{ pages: SpacePage[] }>(
      `/v1/spaces/pages/search?q=${encodeURIComponent(q)}`,
    ),
  createSpacePage: (body: CreateSpacePageRequest) =>
    request<{ view: SpacesView; page: SpacePage }>("/v1/spaces/pages", { method: "POST", body }),
  updateSpacePage: (id: string, body: UpdateSpacePageRequest) =>
    request<{ view: SpacesView; page: SpacePage }>(
      `/v1/spaces/pages/${encodeURIComponent(id)}`,
      { method: "PATCH", body },
    ),
  deleteSpacePage: (id: string) =>
    request<SpacesView>(`/v1/spaces/pages/${encodeURIComponent(id)}`, { method: "DELETE" }),
  approveSpacePageDraft: (body: ApproveSpacePageDraftRequest) =>
    request<{ view: SpacesView; page: SpacePage }>("/v1/spaces/pages/approve-draft", {
      method: "POST",
      body,
    }),
};
