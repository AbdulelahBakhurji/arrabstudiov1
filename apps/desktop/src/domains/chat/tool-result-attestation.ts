import { toolResultAttestationPayload } from "@arrab/shared";

/**
 * SHA-256 hex for tool-result attestation (browser SubtleCrypto).
 */
export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function attestToolResult(
  resultToken: string,
  toolResult: string,
): Promise<string> {
  return sha256Hex(toolResultAttestationPayload(resultToken, toolResult));
}

export function readResultTokenFromApprovalDetail(detail: string | null | undefined): string | null {
  if (!detail?.trim()) return null;
  try {
    const parsed = JSON.parse(detail) as { resultToken?: unknown };
    const token = typeof parsed.resultToken === "string" ? parsed.resultToken.trim() : "";
    return token.length >= 16 ? token : null;
  } catch {
    return null;
  }
}
