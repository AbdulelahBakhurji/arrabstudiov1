export * from "./http";
import { workspaceApi } from "@/domains/workspace/api";
import { accountApi } from "@/domains/account/api";
import { encryptionApi } from "@/domains/encryption/api";
import { organizationApi } from "@/domains/organization/api";
import { chatApi } from "@/domains/chat/api";
import { studioApi } from "@/domains/studio/api";
import { connectorsApi } from "@/domains/connectors/api";
import { companionsApi } from "@/domains/companions/api";
import { familyApi } from "@/domains/family/api";
import { bindE2eeApi } from "@/domains/encryption/e2ee";

/** Composed client — each domain owns its endpoints in `domains/<name>/api.ts`. */
export const arrabApi = {
  ...workspaceApi,
  ...accountApi,
  ...encryptionApi,
  ...organizationApi,
  ...chatApi,
  ...studioApi,
  ...connectorsApi,
  ...companionsApi,
  ...familyApi,
};

// Late-bound so the e2ee module never imports the request layer.
bindE2eeApi(arrabApi);
