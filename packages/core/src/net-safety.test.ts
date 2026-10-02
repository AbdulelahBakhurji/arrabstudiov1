import { describe, expect, it } from "vitest";
import { isBlockedHostname, isBlockedIpAddress, resolvePublicHost } from "./net-safety.js";

describe("isBlockedIpAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.0.10",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "198.18.0.1",
    "::1",
    "::",
    "0:0:0:0:0:0:0:1",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    // IPv4-mapped IPv6 in every textual form (the dotted form is what WHATWG URL rewrites to hex)
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:a9fe:a9fe",
    "0:0:0:0:0:ffff:a00:1",
    // NAT64 / 6to4 wrapping a private v4
    "64:ff9b::a00:1",
    "2002:7f00:1::",
    "not-an-ip",
  ])("blocks %s", (ip) => {
    expect(isBlockedIpAddress(ip)).toBe(true);
  });

  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "172.32.0.1",
    "93.184.216.34",
    "2606:4700:4700::1111",
    "::ffff:808:808",
  ])("allows public %s", (ip) => {
    expect(isBlockedIpAddress(ip)).toBe(false);
  });
});

describe("isBlockedHostname", () => {
  it.each([
    "localhost",
    "LOCALHOST.",
    "foo.localhost",
    "metadata.google.internal",
    "db.internal",
    "printer.local",
    "",
  ])("blocks %s", (host) => expect(isBlockedHostname(host)).toBe(true));
  it("allows ordinary names", () => {
    expect(isBlockedHostname("example.com")).toBe(false);
  });
});

describe("resolvePublicHost", () => {
  it("rejects private literals without a DNS lookup", async () => {
    await expect(resolvePublicHost("127.0.0.1")).rejects.toThrow(/not allowed/);
    await expect(resolvePublicHost("[::ffff:7f00:1]")).rejects.toThrow(/not allowed/);
    await expect(resolvePublicHost("169.254.169.254")).rejects.toThrow(/not allowed/);
  });
  it("rejects hosts with smuggled characters", async () => {
    await expect(resolvePublicHost("evil.com/@127.0.0.1")).rejects.toThrow(/not valid/);
    await expect(resolvePublicHost("a b")).rejects.toThrow(/not valid/);
  });
  it("accepts a public literal and returns it for pinning", async () => {
    await expect(resolvePublicHost("8.8.8.8")).resolves.toEqual({
      host: "8.8.8.8",
      address: "8.8.8.8",
      family: 4,
    });
  });
});
