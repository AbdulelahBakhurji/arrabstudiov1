/**
 * Hosts a server-provided URL may open in the system browser.
 * TODO(contract): TestFlight links (testflight.apple.com) are not allowlisted yet.
 */
const EXACT_HOSTS = new Set([
  "arrabai.com",
  "apps.apple.com",
  "play.google.com",
  "appgallery.huawei.com",
  "galaxystore.samsung.com",
]);

export function isAllowlistedUrl(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return EXACT_HOSTS.has(host) || host.endsWith(".arrabai.com");
}

export type DeepLinkRoute =
  | { kind: "companion"; id: string }
  | { kind: "chat"; conversationId: string }
  | { kind: "usage" }
  | { kind: "update" };

const SAFE_ID = /^[A-Za-z0-9_-]{1,120}$/;

/**
 * Only `arrab://companions/:id`, `arrab://chat/:conversationId`,
 * `arrab://settings/usage` and `arrab://update`. Anything else is ignored.
 */
export function parseDeepLink(raw: unknown): DeepLinkRoute | null {
  if (typeof raw !== "string") return null;
  const match = /^arrab:\/\/([^?#]*)/i.exec(raw.trim());
  if (!match) return null;
  const parts = match[1]!.split("/").filter(Boolean);
  const [head, second, extra] = parts;
  if (extra !== undefined) return null;
  if (head === "companions" && second && SAFE_ID.test(second)) {
    return { kind: "companion", id: second };
  }
  if (head === "chat" && second && SAFE_ID.test(second)) {
    return { kind: "chat", conversationId: second };
  }
  if (head === "settings" && second === "usage") return { kind: "usage" };
  if (head === "update" && !second) return { kind: "update" };
  return null;
}
