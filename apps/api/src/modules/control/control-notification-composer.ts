import { ServiceUnavailableError, ValidationError } from "@arrab/core";
import { stripThinkBlock, type AiCompletion, type AiCompletionRequest } from "@arrab/ai";
import {
  CONTROL_CLIENT_PLATFORMS,
  CONTROL_NOTIFICATION_KINDS,
  type ControlNotificationDraft,
  type ControlNotificationKind,
} from "@arrab/shared";
import { isAppDeepLink } from "./control-notification-service.js";

export type ComposerGateway = {
  listProviders(): readonly { id: string }[];
  complete(request: AiCompletionRequest): Promise<AiCompletion>;
};

export type ComposerModel = { providerId: string; model: string } | null;

const TONES = ["friendly", "formal", "urgent", "celebratory"] as const;
const KINDS = new Set<string>(CONTROL_NOTIFICATION_KINDS);

const SYSTEM_PROMPT = `You write notifications that Arrab Control sends to people using Arrab Studio.
Arrab Studio is an AI workspace: chat, companions, connectors (Gmail, Calendar, and more), cowork, and family and team spaces. It runs on macOS, Windows, Linux, iPhone and Android, in English and Arabic.

Reply with exactly one JSON object and nothing else (no prose, no code fences):
{"title": string, "body": string | null, "titleAr": string, "bodyAr": string | null, "kind": "info" | "warning" | "update" | "security" | "companion", "href": string | null, "native": boolean, "rationale": string}

Rules:
- title: English, at most 60 characters, sentence case, no trailing period.
- body: English, at most 180 characters, one or two short sentences. null only if the title says everything.
- titleAr / bodyAr: natural Modern Standard Arabic written for Arabic readers, not a word-for-word translation. Same limits.
- Plain text only: no markdown, no emoji unless the brief asks for them, no ALL CAPS, no exclamation marks unless the tone is celebratory.
- Never invent facts. Only mention versions, dates, prices, features or numbers that appear in the brief or release notes.
- kind: "update" for new app versions, "security" for account or safety notices, "warning" for outages or maintenance, "companion" for companion news, otherwise "info".
- href: choose one of these or null. "arrab://update" opens the in-app updater (use it for update notices). "arrab://settings/usage" opens plan usage. "arrab://companions/<id>" or "arrab://chat/<id>" only when that exact id is in the brief. An https link only if it appears verbatim in the brief.
- native: true when it is worth interrupting someone with an operating-system notification (updates, security, outages, time-sensitive news). false for low-priority announcements that can wait in the in-app inbox.
- rationale: one short English sentence telling the operator why you chose this kind, link and delivery.`;

function text(value: unknown, field: string, max: number, required = false): string | null {
  if (value == null || value === "") {
    if (required) throw new ValidationError(`${field} is required`);
    return null;
  }
  if (typeof value !== "string") throw new ValidationError(`${field} must be a string`);
  const trimmed = value.trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  if (!trimmed && required) throw new ValidationError(`${field} is required`);
  return trimmed ? trimmed.slice(0, max) : null;
}

function clip(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export function parseDraftJson(raw: string): Record<string, unknown> {
  const answer = stripThinkBlock(raw).answer.trim();
  const unfenced = answer.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object");
  const parsed = JSON.parse(unfenced.slice(start, end + 1)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
  return parsed as Record<string, unknown>;
}

/** Turn whatever the model returned into a draft that passes `/erp/notifications` validation. */
export function normalizeDraft(
  raw: Record<string, unknown>,
  context: { brief: string; kindHint: ControlNotificationKind | null },
): ControlNotificationDraft {
  const title = clip(raw.title, 60);
  const titleAr = clip(raw.titleAr, 60);
  if (!title || !titleAr) throw new Error("draft is missing a title");
  const kind =
    context.kindHint ??
    (typeof raw.kind === "string" && KINDS.has(raw.kind) ? (raw.kind as ControlNotificationKind) : "info");
  let href = typeof raw.href === "string" ? raw.href.trim() : null;
  if (href) {
    const allowed =
      isAppDeepLink(href) &&
      (href === "arrab://update" || href === "arrab://settings/usage" || context.brief.includes(href.split("/").pop()!));
    const quotedHttps = /^https:\/\//i.test(href) && context.brief.includes(href);
    if (!allowed && !quotedHttps) href = null;
  }
  if (!href && kind === "update") href = "arrab://update";
  return {
    title,
    titleAr,
    body: clip(raw.body, 180),
    bodyAr: clip(raw.bodyAr, 180),
    kind,
    href,
    native: typeof raw.native === "boolean" ? raw.native : kind !== "info",
    rationale: clip(raw.rationale, 240),
  };
}

export class ControlNotificationComposer {
  constructor(
    private readonly gateway: ComposerGateway,
    private readonly model: () => ComposerModel,
  ) {}

  get available(): boolean {
    return this.gateway.listProviders().length > 0 && this.model() !== null;
  }

  async compose(body: unknown): Promise<{ draft: ControlNotificationDraft; audience: Record<string, unknown> }> {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ValidationError("Compose body must be an object");
    }
    const record = body as Record<string, unknown>;
    const brief = text(record.brief, "brief", 2000, true)!;
    const kindHint = record.kind == null || record.kind === "" ? null : String(record.kind);
    if (kindHint && !KINDS.has(kindHint)) {
      throw new ValidationError(`kind must be one of ${CONTROL_NOTIFICATION_KINDS.join(", ")}`);
    }
    const tone = record.tone == null ? "friendly" : String(record.tone);
    if (!(TONES as readonly string[]).includes(tone)) {
      throw new ValidationError(`tone must be one of ${TONES.join(", ")}`);
    }
    const version = text(record.version, "version", 32);
    const releaseNotes = text(record.releaseNotes, "releaseNotes", 6000);
    const platforms = Array.isArray(record.platforms)
      ? record.platforms.filter((p): p is string => typeof p === "string" && (CONTROL_CLIENT_PLATFORMS as readonly string[]).includes(p))
      : [];

    const model = this.model();
    if (!model || this.gateway.listProviders().length === 0) {
      throw new ServiceUnavailableError("AI is not configured on this API, so notifications cannot be drafted");
    }

    const prompt = [
      `Brief from the operator:\n${brief}`,
      kindHint ? `The operator wants kind="${kindHint}".` : null,
      `Tone: ${tone}.`,
      version ? `App version this is about: ${version}.` : null,
      releaseNotes ? `Release notes (summarize the one or two changes people will care about most):\n${releaseNotes}` : null,
      platforms.length ? `Only these platforms will receive it: ${platforms.join(", ")}.` : "Every platform will receive it.",
    ]
      .filter(Boolean)
      .join("\n\n");

    const context = { brief: [brief, releaseNotes ?? ""].join("\n"), kindHint: kindHint as ControlNotificationKind | null };
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const completion = await this.gateway.complete({
          model,
          maxOutputTokens: 700,
          temperature: 0.4,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: prompt },
            ...(attempt > 0
              ? [{ role: "user" as const, content: "Your last reply was not valid. Reply with the JSON object only." }]
              : []),
          ],
        });
        const draft = normalizeDraft(parseDraftJson(completion.message.content ?? ""), context);
        return {
          draft,
          audience: {
            platforms: platforms.length ? platforms : null,
            minVersion: record.minVersion ?? null,
            maxVersion: record.maxVersion ?? null,
            expiresInHours: record.expiresInHours ?? null,
          },
        };
      } catch (error) {
        lastError = error;
        if (error instanceof ValidationError) throw error;
      }
    }
    throw new ServiceUnavailableError(
      `The AI could not draft this notification${lastError instanceof Error ? ` (${lastError.message.slice(0, 120)})` : ""}. Try rephrasing the brief.`,
    );
  }
}
