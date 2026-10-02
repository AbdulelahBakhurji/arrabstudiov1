import { describe, expect, it } from "vitest";
import { fetchUrl, isBlockedIpAddress } from "./web-search.js";

describe("web-search SSRF guards", () => {
  it("flags private and metadata IPs", () => {
    expect(isBlockedIpAddress("127.0.0.1")).toBe(true);
    expect(isBlockedIpAddress("10.0.0.5")).toBe(true);
    expect(isBlockedIpAddress("192.168.1.1")).toBe(true);
    expect(isBlockedIpAddress("169.254.169.254")).toBe(true);
    expect(isBlockedIpAddress("::1")).toBe(true);
    expect(isBlockedIpAddress("8.8.8.8")).toBe(false);
  });

  it("rejects loopback fetch_url without contacting the network", async () => {
    const result = await fetchUrl("http://127.0.0.1:8787/secret");
    expect(result).toMatch(/ERROR: fetch_url blocked/i);
    expect(result).toMatch(/not allowed/i);
  });

  it.each([
    "http://[::ffff:127.0.0.1]:8787/",
    "http://[::ffff:a9fe:a9fe]/latest/meta-data/",
    "http://169.254.169.254/latest/meta-data/",
    "http://localhost./",
    "http://metadata.google.internal/",
    "http://user:pass@example.com/",
    "file:///etc/passwd",
    "ftp://example.com/",
  ])("blocks %s", async (url) => {
    expect(await fetchUrl(url)).toMatch(/ERROR: fetch_url blocked/i);
  });
});
