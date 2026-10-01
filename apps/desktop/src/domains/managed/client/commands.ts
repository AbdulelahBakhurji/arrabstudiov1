import { isAllowlistedUrl } from "./allowlist";
import {
  isExpired,
  parseLocalizedText,
  type ClientCommand,
  type ClientCommandType,
  type CommandAckStatus,
  type LocalizedText,
  type MaintenanceSeverity,
} from "./types";

export const COMMAND_ALLOWLIST: readonly ClientCommandType[] = [
  "refresh_config",
  "show_message",
  "force_update",
  "open_companion",
  "open_url",
  "clear_cache",
  "sign_out",
  "reset_device",
  "request_logs",
];

export type ShowMessagePayload = {
  title: LocalizedText | null;
  body: LocalizedText | null;
  severity: MaintenanceSeverity;
};

/** Everything a command may do. Commands are data: nothing else is reachable. */
export type CommandEffects = {
  refreshConfig: () => void;
  showMessage: (message: ShowMessagePayload) => void;
  forceUpdate: (opts: { blocking: boolean }) => void;
  /** Returns false when the companion is unknown or disabled. */
  openCompanion: (companionId: string) => boolean;
  openUrl: (url: string) => Promise<void>;
  clearCache: () => Promise<void>;
  signOut: () => Promise<void>;
  resetDevice: () => Promise<void>;
  /** Must ask the user first; resolves "declined" when they say no. */
  requestLogs: () => Promise<"uploaded" | "declined">;
};

export type HandledIds = {
  has: (id: string) => boolean;
  add: (id: string) => void;
};

export type CommandResult = { status: CommandAckStatus; error?: string };

/** Bounded, insertion-ordered id set so a command or notice is handled once. */
export function createHandledIds(
  initial: readonly string[] = [],
  max = 300,
  persist?: (ids: string[]) => void,
): HandledIds & { list: () => string[] } {
  const ids = [...initial].slice(-max);
  const set = new Set(ids);
  return {
    has: (id) => set.has(id),
    add: (id) => {
      if (set.has(id)) return;
      set.add(id);
      ids.push(id);
      while (ids.length > max) set.delete(ids.shift()!);
      persist?.([...ids]);
    },
    list: () => [...ids],
  };
}

function isAllowlisted(type: string): type is ClientCommandType {
  return (COMMAND_ALLOWLIST as readonly string[]).includes(type);
}

function severityOf(value: unknown): MaintenanceSeverity {
  return value === "warning" || value === "critical" ? value : "info";
}

export function createCommandRouter(deps: {
  effects: CommandEffects;
  handled: HandledIds;
  now?: () => number;
}) {
  const now = deps.now ?? (() => Date.now());

  async function execute(command: ClientCommand & { type: ClientCommandType }): Promise<CommandResult> {
    const { effects } = deps;
    const payload = command.payload;
    switch (command.type) {
      case "refresh_config":
        effects.refreshConfig();
        return { status: "done" };
      case "show_message": {
        const title = parseLocalizedText(payload.title);
        const body = parseLocalizedText(payload.body);
        if (!title && !body) return { status: "failed", error: "empty message" };
        effects.showMessage({ title, body, severity: severityOf(payload.severity) });
        return { status: "done" };
      }
      case "force_update":
        effects.forceUpdate({ blocking: payload.blocking === true });
        return { status: "done" };
      case "open_companion": {
        const id = typeof payload.companionId === "string" ? payload.companionId : "";
        if (!id) return { status: "failed", error: "missing companionId" };
        return effects.openCompanion(id)
          ? { status: "done" }
          : { status: "failed", error: "companion unavailable" };
      }
      case "open_url":
        if (!isAllowlistedUrl(payload.url)) {
          return { status: "failed", error: "url not allowlisted" };
        }
        await effects.openUrl(payload.url);
        return { status: "done" };
      case "clear_cache":
        await effects.clearCache();
        return { status: "done" };
      case "sign_out":
        await effects.signOut();
        return { status: "done" };
      case "reset_device":
        await effects.resetDevice();
        return { status: "done" };
      case "request_logs": {
        const outcome = await effects.requestLogs();
        return outcome === "uploaded"
          ? { status: "done" }
          : { status: "ignored", error: "user declined" };
      }
    }
  }

  /** Returns null when this id was already handled (nothing to ack again). */
  return async function handle(command: ClientCommand): Promise<CommandResult | null> {
    if (deps.handled.has(command.id)) return null;
    deps.handled.add(command.id);
    if (isExpired(command.expiresAt, now())) return { status: "ignored", error: "expired" };
    if (!isAllowlisted(command.type)) return { status: "ignored", error: "unknown command" };
    try {
      return await execute(command as ClientCommand & { type: ClientCommandType });
    } catch (error) {
      return {
        status: "failed",
        error: error instanceof Error ? error.message.slice(0, 200) : "failed",
      };
    }
  };
}
