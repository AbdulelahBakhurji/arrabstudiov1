import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ControlMaintenance } from "@arrab/shared";
import type { AccountService } from "../services/account-service.js";
import {
  ControlDeskService,
  ControlNotificationService,
  toClientNotification,
  type NotificationAckAction,
} from "../services/control-notification-service.js";

const DEVICE_ID = /^[A-Za-z0-9_-]{8,80}$/;
const PLATFORM = /^[a-z]{2,16}$/;
const VERSION = /^v?\d+(\.\d+){0,3}([-+][0-9A-Za-z.-]{1,32})?$/;
const ACK_ACTIONS = new Set<NotificationAckAction>(["delivered", "opened", "dismissed"]);
const POLL_AFTER_SEC = 120;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function shortString(value: unknown, pattern: RegExp): string | null {
  return typeof value === "string" && pattern.test(value) ? value : null;
}

/** Arrab Control's desk policy in the managed-client `maintenance` shape. */
export function toClientMaintenance(policy: ControlMaintenance) {
  if (!policy.message && !policy.minVersion && !policy.requireUpdate) return null;
  return {
    message: policy.message ? { en: policy.message, ar: policy.message } : null,
    severity: policy.requireUpdate ? "critical" : policy.message ? "warning" : "info",
    requireUpdate: policy.requireUpdate,
    minVersion: policy.minVersion,
    latestVersion: null,
    downloadUrl: null,
    readOnly: false,
    until: null,
  };
}

/**
 * Managed-client endpoints the desktop, iOS and Android apps poll
 * (`/v1/client/sync`) to receive Arrab Control notifications and policy.
 */
export function registerClientRoutes(
  app: FastifyInstance,
  deps: {
    notifications: ControlNotificationService;
    desk: ControlDeskService;
    accounts: AccountService;
  },
): void {
  /** Notices go to signed-in people only (or to everyone on a single-user install). */
  const canReceiveNotices = async (request: FastifyRequest) =>
    Boolean(request.account || request.orgEmployee) || !(await deps.accounts.hasAccount());

  app.post("/v1/client/sync", async (request) => {
    const body = record(request.body);
    const deviceId = shortString(body.deviceId, DEVICE_ID);
    const platform = shortString(body.platform, PLATFORM);
    const version = shortString(body.appVersion, VERSION)?.replace(/^v/i, "") ?? null;

    if (deviceId && platform && version) {
      await deps.desk.checkIn({ deviceId, platform, version }).catch(() => undefined);
    }
    if (deviceId && Array.isArray(body.ackedNotificationIds)) {
      for (const id of body.ackedNotificationIds.slice(0, 200)) {
        if (typeof id === "string") deps.notifications.recordAck(id, "delivered", deviceId);
      }
    }

    const notices = (await canReceiveNotices(request))
      ? await deps.notifications.listFor({ platform, version: version?.split(/[-+]/)[0] ?? null })
      : [];

    return {
      serverTime: new Date().toISOString(),
      pollAfterSec: POLL_AFTER_SEC,
      maintenance: toClientMaintenance(await deps.desk.getPolicy()),
      notifications: notices.map(toClientNotification),
      commands: [],
    };
  });

  app.post("/v1/client/notifications/:id/ack", async (request, reply) => {
    const { id } = request.params as { id: string };
    const action = record(request.body).action;
    if (typeof action === "string" && ACK_ACTIONS.has(action as NotificationAckAction)) {
      const deviceKey = request.account?.id ?? request.ip;
      deps.notifications.recordAck(id, action as NotificationAckAction, deviceKey);
    }
    return reply.code(204).send();
  });

  app.post("/v1/client/commands/:id/ack", async (_request, reply) => reply.code(204).send());
}
