/**
 * Turn approval title/detail (often raw JSON) into full human-readable copy
 * for the presence HUD and toasts.
 */
import { friendlyToolTitle } from "@/components/AgentSteps";
import {
  parseToolArgsFromApproval,
  parseToolNameFromApproval,
} from "@/lib/agent-local-tools";

function looksLikeJson(text: string): boolean {
  const value = text.trim();
  return (
    value.startsWith("{") ||
    value.startsWith("[") ||
    /"conversationId"\s*:/.test(value) ||
    /"toolName"\s*:/.test(value) ||
    /"arguments"\s*:/.test(value)
  );
}

function tidy(text: string, max = 280): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned || looksLikeJson(cleaned)) return "";
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1).trimEnd()}…`;
}

function multilinePreview(content: string | undefined, maxLines = 24, maxChars = 2400): string {
  if (!content?.trim()) return "";
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const kept = lines.slice(0, maxLines);
  let text = kept.join("\n").trimEnd();
  if (lines.length > maxLines) text += "\n…";
  if (text.length > maxChars) text = `${text.slice(0, maxChars - 1).trimEnd()}…`;
  return text;
}

export type ApprovalCopy = {
  title: string;
  body: string;
  /** Optional multi-line file/command preview for the big presence card. */
  preview?: string;
};

/** Readable title + body (+ optional preview) for presence cards. */
export function humanizeApprovalCopy(input: {
  title: string;
  detail?: string | null;
}): ApprovalCopy {
  const titleRaw = input.title?.trim() || "";
  const detailRaw = input.detail?.trim() || "";

  // If "detail" is already human text and title is fine, keep them — but never show JSON.
  const toolName = parseToolNameFromApproval(
    looksLikeJson(detailRaw) ? detailRaw : null,
    titleRaw,
  );
  const args = parseToolArgsFromApproval(looksLikeJson(detailRaw) ? detailRaw : null);

  // Sometimes the whole payload is stuffed into title or body alone.
  const jsonBlob = [detailRaw, titleRaw].find((part) => looksLikeJson(part)) ?? "";
  let blobArgs = args;
  let blobTool = toolName;
  if (jsonBlob) {
    try {
      const parsed = JSON.parse(jsonBlob) as {
        toolName?: string;
        title?: string;
        arguments?: Record<string, string>;
      };
      if (!blobTool && parsed.toolName) blobTool = parsed.toolName;
      if (parsed.arguments && Object.keys(blobArgs).length === 0) {
        blobArgs = parsed.arguments;
      }
    } catch {
      /* ignore */
    }
  }

  const pathHint =
    blobArgs.path ||
    blobArgs.relative ||
    blobArgs.command ||
    blobArgs.query ||
    blobArgs.to ||
    blobArgs.subject ||
    blobArgs.url ||
    "";

  const preview = multilinePreview(blobArgs.content || blobArgs.command);

  if (blobTool) {
    const title =
      tidy(friendlyToolTitle(blobTool, pathHint || undefined), 120) || "Needs approval";
    const summaryBits: string[] = [];
    if (pathHint && !title.toLowerCase().includes(pathHint.toLowerCase().slice(0, 18))) {
      summaryBits.push(pathHint);
    }
    if (blobTool === "write_file" || blobTool === "apply_patch") {
      summaryBits.push("Review the file content below, then approve.");
    } else if (blobTool === "run_terminal") {
      summaryBits.push("Review the command below, then approve.");
    } else {
      summaryBits.push("Approve to let Arrab continue.");
    }
    return {
      title,
      body: summaryBits.join(" · "),
      preview: preview || undefined,
    };
  }

  const colon = titleRaw.match(/^([A-Za-z][\w\s/-]{0,40}):\s*(.+)$/);
  if (colon && !looksLikeJson(colon[2] ?? "")) {
    const label = colon[1]!.trim();
    const rest = colon[2]!.trim();
    const inferred = parseToolNameFromApproval(null, titleRaw);
    const title =
      tidy(friendlyToolTitle(inferred || label, rest), 120) ||
      tidy(`${label}: ${rest}`, 120) ||
      "Needs approval";
    return {
      title,
      body: tidy(rest, 200) || "Approve to let Arrab continue.",
      preview: preview || undefined,
    };
  }

  if (looksLikeJson(titleRaw) || looksLikeJson(detailRaw)) {
    return {
      title: "Needs your approval",
      body: "Approve to let Arrab continue this step.",
      preview: preview || undefined,
    };
  }

  return {
    title: tidy(titleRaw, 120) || "Needs approval",
    body:
      (!looksLikeJson(detailRaw) ? tidy(detailRaw, 240) : "") ||
      "Approve to let Arrab continue this step.",
    preview: preview || undefined,
  };
}

/** Presence display copy — always human-readable, never raw JSON. */
export function presenceDisplayCopy(payload: {
  title?: string | null;
  body?: string | null;
  state?: string;
}): ApprovalCopy {
  const title = payload.title?.trim() || "";
  const body = payload.body?.trim() || "";
  if (looksLikeJson(title) || looksLikeJson(body) || /^Write:|^Run:|^Patch:|^Read:|^List:/i.test(title)) {
    return humanizeApprovalCopy({
      title: looksLikeJson(title) ? "Needs approval" : title,
      detail: looksLikeJson(body) ? body : looksLikeJson(title) ? title : body,
    });
  }
  return {
    title: tidy(title, 120) || (payload.state === "needs_you" ? "Needs your approval" : "Arrab"),
    body: tidy(body, 320),
  };
}

/** Sanitize any presence/toast strings that accidentally include JSON. */
export function sanitizePresenceText(text: string | undefined | null, fallback = ""): string {
  if (!text?.trim()) return fallback;
  if (looksLikeJson(text)) return fallback;
  return tidy(text, 420) || fallback;
}
