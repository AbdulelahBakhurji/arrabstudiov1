
import { request } from "@/core/api/http";


export const encryptionApi = {

  // Zero-knowledge chat vault (ciphertext only — see lib/e2ee.ts).
  e2eeKey: () => request<import("@arrab/shared").E2eeKeyResponse>("/v1/e2ee/key"),
  e2eePutKey: (body: import("@arrab/shared").E2eePutKeyRequest) =>
    request<import("@arrab/shared").E2eeKeyResponse>("/v1/e2ee/key", { method: "PUT", body }),
  e2eeChats: (since?: string) =>
    request<import("@arrab/shared").E2eeChatsResponse>(
      since ? `/v1/e2ee/chats?since=${encodeURIComponent(since)}` : "/v1/e2ee/chats",
      { timeoutMs: 30_000 },
    ),
  e2eePutChat: (id: string, body: import("@arrab/shared").E2eePutChatRequest) =>
    request<unknown>(`/v1/e2ee/chats/${encodeURIComponent(id)}`, {
      method: "PUT",
      body,
      timeoutMs: 30_000,
    }),
  e2eeDeleteChat: (id: string) =>
    request<{ ok: true }>(`/v1/e2ee/chats/${encodeURIComponent(id)}`, { method: "DELETE" }),
  e2eeReset: () => request<{ ok: true }>("/v1/e2ee", { method: "DELETE" }),
};
