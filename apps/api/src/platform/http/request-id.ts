import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

/** Accept a caller-supplied correlation id only if it is short and boring (it ends up in logs and headers). */
const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

export function requestIdFrom(req: Pick<IncomingMessage, "headers">): string {
  const raw = req.headers["x-request-id"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && SAFE_ID.test(value) ? value : randomUUID();
}
