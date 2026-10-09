import type {
  E2eeClaimHandoffRequest,
  E2eeCreateHandoffRequest,
  E2eePutKeyRequest,
  E2eePutChatRequest,
} from "@arrab/shared";
import type { FastifyInstance } from "fastify";
import type { V1Deps } from "../../http/deps.js";

export function registerEncryptionRoutes(app: FastifyInstance, deps: V1Deps): void {
  // Zero-knowledge chat vault — ciphertext only; sessions are required (default-deny).
  app.get("/v1/e2ee/key", async () => deps.sealedVault.getKey());

  app.put<{ Body: E2eePutKeyRequest }>("/v1/e2ee/key", async (request) =>
    deps.sealedVault.putKey(request.body ?? ({} as E2eePutKeyRequest)),
  );

  app.delete("/v1/e2ee", async () => deps.sealedVault.reset());

  app.get<{ Querystring: { since?: string } }>("/v1/e2ee/chats", async (request) =>
    deps.sealedVault.listChats(request.query.since),
  );

  app.put<{ Params: { id: string }; Body: E2eePutChatRequest }>(
    "/v1/e2ee/chats/:id",
    { bodyLimit: 8 * 1024 * 1024 },
    async (request) =>
      deps.sealedVault.putChat(request.params.id, request.body ?? ({} as E2eePutChatRequest)),
  );

  app.delete<{ Params: { id: string } }>("/v1/e2ee/chats/:id", async (request) =>
    deps.sealedVault.deleteChat(request.params.id),
  );

  app.post<{ Body: E2eeCreateHandoffRequest }>("/v1/e2ee/handoffs", async (request) => {
    const ids = Array.isArray(request.body?.conversationIds)
      ? request.body.conversationIds.map((id) => String(id))
      : [];
    const primary = String(request.body?.conversationId ?? ids[0] ?? "");
    return deps.sealedVault.createHandoff(primary, ids);
  });

  app.post<{ Body: E2eeClaimHandoffRequest }>("/v1/e2ee/handoffs/claim", async (request) =>
    deps.sealedVault.claimHandoff(String(request.body?.code ?? "")),
  );
}
