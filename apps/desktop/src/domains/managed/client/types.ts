/**
 * Arrab Control managed-client contract (see docs/MANAGED_CLIENT.md).
 * Field names match the server contract exactly. Parsers are tolerant: every
 * top-level response field is optional, unknown fields are dropped, and a
 * malformed item is skipped instead of failing the whole response.
 */

export type ClientPlatform = "macos" | "windows" | "linux" | "ios" | "ipados" | "android";
export type ClientVendor =
  | "apple"
  | "microsoft"
  | "samsung"
  | "huawei"
  | "google"
  | "xiaomi"
  | "other";
export type PushProvider = "apns" | "fcm" | "hms" | "none";
export type ClientCapability =
  | "local_notifications"
  | "remote_push"
  | "auto_update"
  | "deep_link"
  | "menu_bar"
  | "health_sync";
export type ClientState = "foreground" | "background" | "idle";
export type ActiveScreen = "home" | "chat" | "companions" | "work" | "settings" | "family" | "other";

export type LocalizedText = { en: string; ar: string };

export type SyncRequest = {
  deviceId: string;
  platform: ClientPlatform;
  vendor: ClientVendor;
  osVersion: string;
  appVersion: string;
  build: string;
  channel: string;
  locale: string;
  timezone: string;
  pushProvider: PushProvider;
  pushToken: string | null;
  capabilities: ClientCapability[];
  state: ClientState;
  activeScreen: ActiveScreen;
  activeCompanionId: string | null;
  configVersion: string | null;
  ackedCommandIds: string[];
  ackedNotificationIds: string[];
};

export type MaintenanceSeverity = "info" | "warning" | "critical";

export type Maintenance = {
  message: LocalizedText | null;
  severity: MaintenanceSeverity;
  requireUpdate: boolean;
  minVersion: string | null;
  latestVersion: string | null;
  downloadUrl: string | null;
  readOnly: boolean;
  until: string | null;
};

export type CompanionBadge = "new" | "beta";

export type CompanionPolicy = {
  id: string;
  enabled: boolean;
  visible: boolean;
  pinned: boolean;
  order: number | null;
  badge: CompanionBadge | null;
  maintenance: string | null;
};

export type ClientLimits = {
  plan: string | null;
  messagesPerDay: number | null;
  messagesUsedToday: number | null;
  tokensPerMonth: number | null;
  tokensUsedThisMonth: number | null;
  maxAttachmentsMb: number | null;
  maxCompanions: number | null;
  resetsAt: string | null;
};

export type ClientFeatures = Record<string, boolean>;

export type ClientConfig = {
  version: string | null;
  companions: CompanionPolicy[];
  limits: ClientLimits | null;
  features: ClientFeatures;
};

export type NotificationKind = "info" | "warning" | "update" | "security" | "companion";

export type ClientNotification = {
  id: string;
  title: LocalizedText;
  body: LocalizedText | null;
  kind: NotificationKind;
  deepLink: string | null;
  native: boolean;
  inApp: boolean;
  expiresAt: string | null;
};

export type ClientCommandType =
  | "refresh_config"
  | "show_message"
  | "force_update"
  | "open_companion"
  | "open_url"
  | "clear_cache"
  | "sign_out"
  | "reset_device"
  | "request_logs";

export type ClientCommand = {
  id: string;
  /** Kept as a raw string so unknown types can be acked as `ignored`. */
  type: string;
  payload: Record<string, unknown>;
  issuedAt: string | null;
  expiresAt: string | null;
};

export type SyncResponse = {
  serverTime: string | null;
  pollAfterSec: number | null;
  maintenance: Maintenance | null;
  config: ClientConfig | null;
  notifications: ClientNotification[];
  commands: ClientCommand[];
};

export type CommandAckStatus = "done" | "failed" | "ignored";
export type NotificationAckAction = "delivered" | "opened" | "dismissed";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** `{en, ar}` from the server; a bare string is accepted for both languages. */
export function parseLocalizedText(value: unknown): LocalizedText | null {
  if (typeof value === "string") {
    return value.trim() ? { en: value, ar: value } : null;
  }
  if (!isRecord(value)) return null;
  const en = str(value.en);
  const ar = str(value.ar);
  if (!en && !ar) return null;
  return { en: en ?? ar!, ar: ar ?? en! };
}

export function localized(text: LocalizedText | null | undefined, locale: string): string {
  if (!text) return "";
  return locale.toLowerCase().startsWith("ar") ? text.ar : text.en;
}

export function parseMaintenance(value: unknown): Maintenance | null {
  if (!isRecord(value)) return null;
  return {
    message: parseLocalizedText(value.message),
    severity: oneOf(value.severity, ["info", "warning", "critical"] as const, "info"),
    requireUpdate: bool(value.requireUpdate, false),
    minVersion: str(value.minVersion),
    latestVersion: str(value.latestVersion),
    downloadUrl: str(value.downloadUrl),
    readOnly: bool(value.readOnly, false),
    until: str(value.until),
  };
}

export function parseCompanionPolicy(value: unknown): CompanionPolicy | null {
  if (!isRecord(value)) return null;
  const id = str(value.id);
  if (!id) return null;
  return {
    id,
    enabled: bool(value.enabled, true),
    visible: bool(value.visible, true),
    pinned: bool(value.pinned, false),
    order: num(value.order),
    badge: value.badge === "new" || value.badge === "beta" ? value.badge : null,
    maintenance: str(value.maintenance),
  };
}

export function parseLimits(value: unknown): ClientLimits | null {
  if (!isRecord(value)) return null;
  return {
    plan: str(value.plan),
    messagesPerDay: num(value.messagesPerDay),
    messagesUsedToday: num(value.messagesUsedToday),
    tokensPerMonth: num(value.tokensPerMonth),
    tokensUsedThisMonth: num(value.tokensUsedThisMonth),
    maxAttachmentsMb: num(value.maxAttachmentsMb),
    maxCompanions: num(value.maxCompanions),
    resetsAt: str(value.resetsAt),
  };
}

export function parseFeatures(value: unknown): ClientFeatures {
  if (!isRecord(value)) return {};
  const out: ClientFeatures = {};
  for (const [key, flag] of Object.entries(value)) {
    if (typeof flag === "boolean") out[key] = flag;
  }
  return out;
}

export function parseConfig(value: unknown): ClientConfig | null {
  if (!isRecord(value)) return null;
  const companions = Array.isArray(value.companions)
    ? value.companions
        .map(parseCompanionPolicy)
        .filter((item): item is CompanionPolicy => item !== null)
    : [];
  return {
    version: str(value.version),
    companions,
    limits: parseLimits(value.limits),
    features: parseFeatures(value.features),
  };
}

export function parseNotification(value: unknown): ClientNotification | null {
  if (!isRecord(value)) return null;
  const id = str(value.id);
  const title = parseLocalizedText(value.title);
  if (!id || !title) return null;
  return {
    id,
    title,
    body: parseLocalizedText(value.body),
    kind: oneOf(value.kind, ["info", "warning", "update", "security", "companion"] as const, "info"),
    deepLink: str(value.deepLink),
    native: bool(value.native, false),
    inApp: bool(value.inApp, true),
    expiresAt: str(value.expiresAt),
  };
}

export function parseCommand(value: unknown): ClientCommand | null {
  if (!isRecord(value)) return null;
  const id = str(value.id);
  const type = str(value.type);
  if (!id || !type) return null;
  return {
    id,
    type,
    payload: isRecord(value.payload) ? value.payload : {},
    issuedAt: str(value.issuedAt),
    expiresAt: str(value.expiresAt),
  };
}

function parseList<T>(value: unknown, parse: (item: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  return value.map(parse).filter((item): item is T => item !== null);
}

export function parseSyncResponse(value: unknown): SyncResponse {
  const root = isRecord(value) ? value : {};
  return {
    serverTime: str(root.serverTime),
    pollAfterSec: num(root.pollAfterSec),
    maintenance: parseMaintenance(root.maintenance),
    config: parseConfig(root.config),
    notifications: parseList(root.notifications, parseNotification),
    commands: parseList(root.commands, parseCommand),
  };
}

/** Parse a JSON body; anything unparseable becomes an empty response. */
export function parseSyncResponseText(body: string): SyncResponse {
  try {
    return parseSyncResponse(JSON.parse(body) as unknown);
  } catch {
    return parseSyncResponse(null);
  }
}

export function isExpired(expiresAt: string | null, now: number): boolean {
  if (!expiresAt) return false;
  const at = Date.parse(expiresAt);
  return Number.isFinite(at) && at <= now;
}
