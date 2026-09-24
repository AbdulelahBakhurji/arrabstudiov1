import type { ResolveApprovalRequest } from "@arrab/shared";
import {
  attestToolResult,
  readResultTokenFromApprovalDetail,
} from "@/lib/tool-result-attestation";

/** Build resolve body with attested toolResult when the approval carries a resultToken. */
export async function buildResolveApprovalBody(input: {
  status: "approved" | "rejected";
  approvalDetail?: string | null;
  toolResult?: string | null;
}): Promise<ResolveApprovalRequest> {
  const toolResult = input.toolResult?.trim() ? input.toolResult : null;
  if (input.status !== "approved" || !toolResult) {
    return { status: input.status, toolResult };
  }
  const resultToken = readResultTokenFromApprovalDetail(input.approvalDetail);
  if (!resultToken) {
    return { status: input.status, toolResult };
  }
  const toolResultAttestation = await attestToolResult(resultToken, toolResult);
  return { status: input.status, toolResult, toolResultAttestation };
}
