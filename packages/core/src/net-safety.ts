/**
 * Outbound-network safety (SSRF defence) shared by every server-side feature that
 * connects to a host a user or a model can influence: web tools, SSH, IMAP/SMTP.
 *
 * Node-only: imports `node:dns` / `node:net`.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ValidationError } from "./errors.js";

function ipv4Octets(ip: string): [number, number, number, number] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums as [number, number, number, number];
}

/** Expand any textual IPv6 form (compressed, embedded dotted-quad) into 8 hextets. */
function ipv6Hextets(input: string): number[] | null {
  let text = input.toLowerCase().replace(/^\[|\]$/g, "");
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  if (isIP(text) !== 6) return null;

  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const octets = ipv4Octets(dotted[2]!);
    if (!octets) return null;
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    text = `${dotted[1]}${high}:${low}`;
  }

  const [head, tail, ...extra] = text.split("::");
  if (extra.length > 0) return null;
  const left = head ? head.split(":") : [];
  const right = tail !== undefined && tail ? tail.split(":") : [];
  const missing = 8 - left.length - right.length;
  if (tail === undefined ? left.length !== 8 : missing < 0) return null;
  const all = tail === undefined ? left : [...left, ...Array<string>(missing).fill("0"), ...right];
  const parsed = all.map((group) =>
    /^[0-9a-f]{1,4}$/.test(group) ? Number.parseInt(group, 16) : Number.NaN,
  );
  return parsed.length === 8 && parsed.every((n) => Number.isInteger(n)) ? parsed : null;
}

function blockedIpv4(a: number, b: number, c: number): boolean {
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  return a >= 224; // multicast + reserved + broadcast
}

/** True for loopback, private, link-local, metadata, multicast and other non-public addresses. */
export function isBlockedIpAddress(ip: string): boolean {
  const v4 = ipv4Octets(ip.trim());
  if (v4) return blockedIpv4(v4[0], v4[1], v4[2]);

  const groups = ipv6Hextets(ip.trim());
  if (!groups) return true; // not a parseable address — never allow it
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const embeddedV4 = (high: number, low: number) => blockedIpv4(high >> 8, high & 0xff, low >> 8);

  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0) {
    if (g5 === 0 && g6 === 0 && (g7 === 0 || g7 === 1)) return true; // :: and ::1
    if (g5 === 0xffff) return embeddedV4(g6, g7); // IPv4-mapped (any textual form)
    if (g5 === 0) return embeddedV4(g6, g7); // deprecated IPv4-compatible
  }
  if (g0 === 0x64 && g1 === 0xff9b) return embeddedV4(g6, g7); // NAT64
  if (g0 === 0x2002) return embeddedV4(g1, g2); // 6to4
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g0 & 0xff00) === 0xff00) return true; // multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // documentation
  return false;
}

const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".internal",
  ".local",
  ".localdomain",
  ".lan",
  ".home.arpa",
];

/** Hostname-level rules that hold before any DNS lookup. */
export function isBlockedHostname(host: string): boolean {
  const name = host.trim().replace(/\.$/, "").toLowerCase();
  if (!name) return true;
  if (name === "localhost" || name === "metadata.google.internal") return true;
  return BLOCKED_HOST_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

export type ResolvedPublicHost = { host: string; address: string; family: 4 | 6 };

/**
 * Resolve `host` and require every address to be public. Returns one vetted address so the
 * caller can connect to *that* IP (pinning), closing the DNS-rebinding window between the
 * check and the connection.
 */
export async function resolvePublicHost(host: string): Promise<ResolvedPublicHost> {
  const name = host.trim().replace(/^\[|\]$/g, "");
  if (!name || name.length > 253 || /[\s/\\@]/.test(name)) {
    throw new ValidationError("That host name is not valid");
  }
  if (isBlockedHostname(name)) {
    throw new ValidationError("Private, local and metadata hosts are not allowed");
  }
  const literal = isIP(name);
  let addresses: Array<{ address: string; family: number }>;
  if (literal) {
    addresses = [{ address: name, family: literal }];
  } else {
    try {
      addresses = await lookup(name, { all: true, verbatim: true });
    } catch {
      throw new ValidationError("That host could not be resolved");
    }
  }
  if (addresses.length === 0) throw new ValidationError("That host could not be resolved");
  if (addresses.some((entry) => isBlockedIpAddress(entry.address))) {
    throw new ValidationError("Private, local and metadata hosts are not allowed");
  }
  const first = addresses[0]!;
  return { host: name, address: first.address, family: first.family === 6 ? 6 : 4 };
}
