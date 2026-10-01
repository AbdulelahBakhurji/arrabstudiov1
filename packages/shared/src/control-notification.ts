export const CONTROL_NOTIFICATION_KINDS = ["info", "warning", "update", "security", "companion"] as const;
export type ControlNotificationKind = (typeof CONTROL_NOTIFICATION_KINDS)[number];

export const CONTROL_CLIENT_PLATFORMS = ["macos", "windows", "linux", "ios", "ipados", "android"] as const;
export type ControlClientPlatform = (typeof CONTROL_CLIENT_PLATFORMS)[number];

export type ControlNotificationStats = {
  delivered: number;
  opened: number;
  dismissed: number;
};

/**
 * A notice Arrab Control sends to every signed-in app. Fields after `createdAt`
 * are optional so notices stored before they existed still load.
 */
export type ControlNotification = {
  id: string;
  title: string;
  body: string | null;
  href: string | null;
  createdAt: string;
  titleAr?: string | null;
  bodyAr?: string | null;
  kind?: ControlNotificationKind;
  /** Show an OS notification (Notification Center / Action Center / push), not just the in-app inbox. */
  native?: boolean;
  inApp?: boolean;
  expiresAt?: string | null;
  /** null or empty = every platform. */
  platforms?: ControlClientPlatform[] | null;
  minVersion?: string | null;
  maxVersion?: string | null;
  source?: "manual" | "ai";
  retractedAt?: string | null;
  stats?: ControlNotificationStats;
};

/** What the AI composer proposes. Control reviews it, then posts it to `/erp/notifications`. */
export type ControlNotificationDraft = {
  title: string;
  titleAr: string;
  body: string | null;
  bodyAr: string | null;
  kind: ControlNotificationKind;
  href: string | null;
  native: boolean;
  rationale: string | null;
};
