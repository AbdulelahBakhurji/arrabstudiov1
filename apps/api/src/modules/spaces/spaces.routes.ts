import type {
  ApproveSpacePageDraftRequest,
  CreateDocumentSpaceRequest,
  CreateSpacePageRequest,
  UpdateDocumentSpaceRequest,
  UpdateSpacePageRequest,
} from "@arrab/shared";
import type { FastifyInstance } from "fastify";
import type { V1Deps } from "../../http/deps.js";

export function registerSpacesRoutes(app: FastifyInstance, deps: V1Deps): void {
  app.get("/v1/spaces", async () => deps.spaces.get());

  app.post<{ Body: CreateDocumentSpaceRequest }>("/v1/spaces", async (request) =>
    deps.spaces.createSpace(request.body ?? { name: "" }),
  );

  app.patch<{ Params: { id: string }; Body: UpdateDocumentSpaceRequest }>(
    "/v1/spaces/:id",
    async (request) => deps.spaces.updateSpace(request.params.id, request.body ?? {}),
  );

  app.delete<{ Params: { id: string } }>("/v1/spaces/:id", async (request) =>
    deps.spaces.deleteSpace(request.params.id),
  );

  app.get<{ Querystring: { q?: string } }>("/v1/spaces/pages/search", async (request) =>
    deps.spaces.search(request.query?.q ?? ""),
  );

  app.post<{ Body: CreateSpacePageRequest }>("/v1/spaces/pages", async (request) =>
    deps.spaces.createPage(request.body ?? { spaceId: "", title: "" }),
  );

  app.patch<{ Params: { id: string }; Body: UpdateSpacePageRequest }>(
    "/v1/spaces/pages/:id",
    async (request) =>
      deps.spaces.updatePage(request.params.id, request.body ?? { revision: 0 }),
  );

  app.delete<{ Params: { id: string } }>("/v1/spaces/pages/:id", async (request) =>
    deps.spaces.deletePage(request.params.id),
  );

  app.post<{ Body: ApproveSpacePageDraftRequest }>("/v1/spaces/pages/approve-draft", async (request) =>
    deps.spaces.approveDraft(request.body ?? { spaceId: "", title: "", markdown: "" }),
  );
}
