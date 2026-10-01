import { randomUUID } from "node:crypto";
import { NotFoundError, ValidationError } from "@arrab/core";
import type { ControlNotificationRepository } from "@arrab/database";
import {
  CONNECTOR_PROVIDERS,
  CONTROL_CLIENT_PLATFORMS,
  CONTROL_NOTIFICATION_KINDS,
  type ConnectorProvider,
  type ControlClientPlatform,
  type ControlConnector,
  type ControlNotification,
  type ControlNotificationKind,
  type ControlNotificationStats,
  type ControlMaintenance,
} from "@arrab/shared";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("Notification body must be an object");
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") throw new ValidationError(`${field} must be a string`);
  const trimmed = value.trim().replace(/[\u0000-\u001F\u007F]/g, "");
  if (!trimmed) throw new ValidationError(`${field} is required`);
  return trimmed.slice(0, max);
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value == null || value === "") return null;
  return requiredText(value, field, max);
}

function optionalHref(value: unknown): string | null {
  const href = optionalText(value, "href", 500);
  if (!href) return null;
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  if (/^arrab:\/\//i.test(href)) {
    if (!isAppDeepLink(href)) {
      throw new ValidationError(
        "arrab:// links must be arrab://update, arrab://settings/usage, arrab://companions/<id> or arrab://chat/<id>",
      );
    }
    return href;
  }
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    throw new ValidationError("href must be an https link or an in-app path");
  }
  if (url.protocol !== "https:") {
    throw new ValidationError("href must be an https link or an in-app path");
  }
  return url.toString();
}

const KINDS = new Set<string>(CONTROL_NOTIFICATION_KINDS);
const PLATFORMS = new Set<string>(CONTROL_CLIENT_PLATFORMS);
const VERSION_PATTERN = /^\d+(\.\d+){0,3}$/;
const MAX_EXPIRY_HOURS = 24 * 90;
const ACK_FLUSH_MS = 10_000;
const ACK_DEDUPE_LIMIT = 50_000;

export type NotificationAckAction = keyof ControlNotificationStats;

function optionalKind(value: unknown): ControlNotificationKind {
  if (value == null || value === "") return "info";
  if (typeof value !== "string" || !KINDS.has(value)) {
    throw new ValidationError(`kind must be one of ${CONTROL_NOTIFICATION_KINDS.join(", ")}`);
  }
  return value as ControlNotificationKind;
}

function optionalPlatforms(value: unknown): ControlClientPlatform[] | null {
  if (value == null) return null;
  if (!Array.isArray(value)) throw new ValidationError("platforms must be an array");
  const out = new Set<ControlClientPlatform>();
  for (const entry of value) {
    if (typeof entry !== "string" || !PLATFORMS.has(entry)) {
      throw new ValidationError(`platforms must only contain ${CONTROL_CLIENT_PLATFORMS.join(", ")}`);
    }
    out.add(entry as ControlClientPlatform);
  }
  return out.size ? [...out] : null;
}

function optionalVersion(value: unknown, field: string): string | null {
  const text = optionalText(value, field, 32);
  if (!text) return null;
  const clean = text.replace(/^v/i, "");
  if (!VERSION_PATTERN.test(clean)) throw new ValidationError(`${field} must look like 1.2.3`);
  return clean;
}

function optionalExpiry(record: Record<string, unknown>, now: number): string | null {
  if (record.expiresInHours != null) {
    const hours = record.expiresInHours;
    if (typeof hours !== "number" || !Number.isFinite(hours) || hours <= 0 || hours > MAX_EXPIRY_HOURS) {
      throw new ValidationError(`expiresInHours must be between 0 and ${MAX_EXPIRY_HOURS}`);
    }
    return new Date(now + hours * 3_600_000).toISOString();
  }
  const raw = optionalText(record.expiresAt, "expiresAt", 40);
  if (!raw) return null;
  const at = Date.parse(raw);
  if (!Number.isFinite(at) || at <= now) throw new ValidationError("expiresAt must be a future ISO date");
  return new Date(at).toISOString();
}

export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.replace(/^v/i, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export type NotificationAudience = {
  platform: string | null;
  version: string | null;
};

export function isNotificationLive(item: ControlNotification, now: number): boolean {
  if (item.retractedAt) return false;
  if (item.expiresAt && Date.parse(item.expiresAt) <= now) return false;
  return true;
}

export function notificationMatchesAudience(item: ControlNotification, audience: NotificationAudience): boolean {
  if (item.platforms?.length) {
    if (!audience.platform || !item.platforms.includes(audience.platform as ControlClientPlatform)) return false;
  }
  if (item.minVersion || item.maxVersion) {
    if (!audience.version || !VERSION_PATTERN.test(audience.version.replace(/^v/i, ""))) return false;
    if (item.minVersion && compareVersions(audience.version, item.minVersion) < 0) return false;
    if (item.maxVersion && compareVersions(audience.version, item.maxVersion) > 0) return false;
  }
  return true;
}

/** The managed-client contract shape (`/v1/client/sync` → `notifications[]`). */
export function toClientNotification(item: ControlNotification) {
  const titleAr = item.titleAr?.trim() || item.title;
  const bodyAr = item.bodyAr?.trim() || item.body;
  return {
    id: item.id,
    title: { en: item.title, ar: titleAr },
    body: item.body || bodyAr ? { en: item.body ?? bodyAr ?? "", ar: bodyAr ?? item.body ?? "" } : null,
    kind: item.kind ?? "info",
    deepLink: item.href,
    native: item.native ?? false,
    inApp: item.inApp ?? true,
    expiresAt: item.expiresAt ?? null,
  };
}

/** Mirrors the app-side deep-link allowlist; anything else is dropped by the apps. */
export function isAppDeepLink(href: string): boolean {
  return /^arrab:\/\/(update|settings\/usage|(companions|chat)\/[A-Za-z0-9_-]{1,120})$/.test(href);
}

export class ControlNotificationService {
  private readonly seenAcks = new Set<string>();
  private readonly pendingAcks = new Map<string, ControlNotificationStats>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly repo: ControlNotificationRepository,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Control sees everything; apps only see live notices. */
  async listRecent(limit = 30, options?: { includeInactive?: boolean }): Promise<ControlNotification[]> {
    const items = await this.repo.listRecent(limit);
    if (options?.includeInactive) return items;
    const now = this.now();
    return items.filter((item) => isNotificationLive(item, now));
  }

  async listFor(audience: NotificationAudience, limit = 20): Promise<ControlNotification[]> {
    const now = this.now();
    const items = await this.repo.listRecent(100);
    return items
      .filter((item) => isNotificationLive(item, now) && notificationMatchesAudience(item, audience))
      .slice(0, limit);
  }

  async create(body: unknown): Promise<ControlNotification> {
    const record = asRecord(body);
    const now = this.now();
    const minVersion = optionalVersion(record.minVersion, "minVersion");
    const maxVersion = optionalVersion(record.maxVersion, "maxVersion");
    if (minVersion && maxVersion && compareVersions(minVersion, maxVersion) > 0) {
      throw new ValidationError("minVersion must not be greater than maxVersion");
    }
    const kind = optionalKind(record.kind);
    const inApp = record.inApp !== false;
    const native = record.native !== false;
    if (!inApp && !native) throw new ValidationError("A notification must show in-app, natively, or both");
    const item: ControlNotification = {
      id: `nt_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
      title: requiredText(record.title, "title", 120),
      body: optionalText(record.body, "body", 500),
      href: optionalHref(record.href),
      createdAt: new Date(now).toISOString(),
      titleAr: optionalText(record.titleAr, "titleAr", 120),
      bodyAr: optionalText(record.bodyAr, "bodyAr", 500),
      kind,
      native,
      inApp,
      expiresAt: optionalExpiry(record, now),
      platforms: optionalPlatforms(record.platforms),
      minVersion,
      maxVersion,
      source: record.source === "ai" ? "ai" : "manual",
      retractedAt: null,
      stats: { delivered: 0, opened: 0, dismissed: 0 },
    };
    return this.repo.insert(item);
  }

  /** Stops apps from receiving it. Devices that already showed it keep it in their inbox. */
  async retract(id: string): Promise<ControlNotification> {
    const item = await this.repo.getById(id);
    if (!item) throw new NotFoundError("Notification", id.slice(0, 40));
    if (item.retractedAt) return item;
    const next = { ...item, retractedAt: new Date(this.now()).toISOString() };
    return (await this.repo.replace(next)) ?? next;
  }

  /**
   * Counts one delivered/opened/dismissed per device. Writes are batched so a
   * fleet acking at once does not hammer the database.
   */
  recordAck(id: string, action: NotificationAckAction, deviceKey: string): void {
    if (!/^nt_[a-z0-9]{8,40}$/i.test(id)) return;
    const key = `${id}|${action}|${deviceKey}`;
    if (this.seenAcks.has(key)) return;
    if (this.seenAcks.size >= ACK_DEDUPE_LIMIT) this.seenAcks.clear();
    this.seenAcks.add(key);
    const pending = this.pendingAcks.get(id) ?? { delivered: 0, opened: 0, dismissed: 0 };
    pending[action] += 1;
    this.pendingAcks.set(id, pending);
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => void this.flushAcks(), ACK_FLUSH_MS);
      this.flushTimer.unref?.();
    }
  }

  async flushAcks(): Promise<void> {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    const batch = [...this.pendingAcks];
    this.pendingAcks.clear();
    for (const [id, delta] of batch) {
      const item = await this.repo.getById(id).catch(() => null);
      if (!item) continue;
      const stats = item.stats ?? { delivered: 0, opened: 0, dismissed: 0 };
      await this.repo
        .replace({
          ...item,
          stats: {
            delivered: stats.delivered + delta.delivered,
            opened: stats.opened + delta.opened,
            dismissed: stats.dismissed + delta.dismissed,
          },
        })
        .catch(() => null);
    }
  }
}

const EMPTY_POLICY: ControlMaintenance = {
  message: null,
  minVersion: null,
  requireUpdate: false,
  updatedAt: new Date(0).toISOString(),
};

export class ControlDeskService {
  constructor(private readonly desk: import("@arrab/database").ControlDeskRepository) {}

  async getPolicy(): Promise<ControlMaintenance> {
    return (await this.desk.getPolicy()) ?? EMPTY_POLICY;
  }

  async setPolicy(body: unknown): Promise<ControlMaintenance> {
    const record = asRecord(body);
    const message = optionalText(record.message, "message", 280);
    const minVersion = optionalText(record.minVersion, "minVersion", 32);
    const requireUpdate = record.requireUpdate === true;
    const policy: ControlMaintenance = {
      message,
      minVersion,
      requireUpdate,
      updatedAt: new Date().toISOString(),
    };
    return this.desk.setPolicy(policy);
  }

  async checkIn(body: unknown): Promise<{ policy: ControlMaintenance }> {
    const record = asRecord(body);
    const deviceId = requiredText(record.deviceId, "deviceId", 80);
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(deviceId)) {
      throw new ValidationError("deviceId is invalid");
    }
    const version = requiredText(record.version, "version", 32);
    const platform = requiredText(record.platform, "platform", 16);
    await this.desk.upsertClient({
      deviceId,
      version,
      platform,
      lastSeenAt: new Date().toISOString(),
    });
    return { policy: await this.getPolicy() };
  }

  async listClients() {
    return { items: await this.desk.listClients() };
  }

  async listConnectors(): Promise<{ items: ControlConnector[] }> {
    const items = await this.desk.listConnectors();
    return { items: items.filter((item) => PROVIDERS.has(item.provider)) };
  }

  async setConnector(provider: string, body: unknown): Promise<ControlConnector> {
    const key = connectorProvider(provider);
    const record = asRecord(body);
    const status = record.status ?? "published";
    if (status !== "published" && status !== "hidden") {
      throw new ValidationError("status must be published or hidden");
    }
    const entry: ControlConnector = {
      provider: key,
      status,
      featured: record.featured === true,
      order: optionalOrder(record.order),
      name: optionalText(record.name, "name", 60),
      nameAr: optionalText(record.nameAr, "nameAr", 60),
      description: optionalText(record.description, "description", 140),
      descriptionAr: optionalText(record.descriptionAr, "descriptionAr", 140),
      logoUrl: optionalLogoUrl(record.logoUrl),
      updatedAt: new Date().toISOString(),
    };
    return this.desk.upsertConnector(entry);
  }

  async resetConnector(provider: string): Promise<{ provider: ConnectorProvider; removed: boolean }> {
    const key = connectorProvider(provider);
    return { provider: key, removed: await this.desk.deleteConnector(key) };
  }
}

const PROVIDERS = new Set<string>(CONNECTOR_PROVIDERS);

function connectorProvider(value: string): ConnectorProvider {
  if (!PROVIDERS.has(value)) {
    throw new ValidationError(`Unknown connector provider: ${value.slice(0, 40)}`);
  }
  return value as ConnectorProvider;
}

function optionalOrder(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new ValidationError("order must be an integer between 0 and 10000");
  }
  return value;
}

function optionalLogoUrl(value: unknown): string | null {
  const raw = optionalText(value, "logoUrl", 500);
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError("logoUrl must be an https URL");
  }
  if (url.protocol !== "https:") throw new ValidationError("logoUrl must be an https URL");
  // Desktop CSP only renders images from these hosts.
  const host = url.hostname.toLowerCase();
  if (host !== "arrabai.com" && !host.endsWith(".arrabai.com")) {
    throw new ValidationError("logoUrl must be hosted on arrabai.com");
  }
  return url.toString();
}
