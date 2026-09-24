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
    expect(result).toMatch(/private or metadata/i);
  });
});
