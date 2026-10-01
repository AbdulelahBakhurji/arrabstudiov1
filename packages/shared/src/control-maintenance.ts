export type ControlMaintenance = {
  message: string | null;
  minVersion: string | null;
  requireUpdate: boolean;
  updatedAt: string;
};

export type ControlClient = {
  deviceId: string;
  version: string;
  platform: string;
  lastSeenAt: string;
};
