import { describe, expect, it } from "vitest";
import { detectPlatformFromAgent } from "@/core/platform/platform-info";

const UA = {
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)",
  win: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/131.0 Mobile",
  huawei: "Mozilla/5.0 (Linux; Android 12; HUAWEI P50 Pro Build/HMSCore) AppleWebKit/537.36 Mobile",
  harmony: "Mozilla/5.0 (Linux; Android 12; HarmonyOS; ALN-AL00) AppleWebKit/537.36 Mobile",
  linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
};

describe("detectPlatformFromAgent", () => {
  it("classifies desktop shells", () => {
    expect(detectPlatformFromAgent(UA.mac, true)).toMatchObject({
      os: "macos",
      form: "desktop",
      shell: "tauri",
    });
    expect(detectPlatformFromAgent(UA.win, true)).toMatchObject({ os: "windows", form: "desktop" });
    expect(detectPlatformFromAgent(UA.linux, true)).toMatchObject({ os: "linux", form: "desktop" });
  });
  it("classifies mobile clients", () => {
    expect(detectPlatformFromAgent(UA.iphone, false)).toMatchObject({ os: "ios", form: "mobile" });
    expect(detectPlatformFromAgent(UA.android, false)).toMatchObject({
      os: "android",
      form: "mobile",
      hasGoogleServices: true,
    });
  });
  it("never assumes Google services on Huawei", () => {
    for (const ua of [UA.huawei, UA.harmony]) {
      expect(detectPlatformFromAgent(ua, false)).toMatchObject({
        os: "huawei",
        form: "mobile",
        hasGoogleServices: false,
      });
    }
  });
  it("is a plain browser when not in a shell", () => {
    expect(detectPlatformFromAgent(UA.mac, false)).toMatchObject({
      os: "macos",
      form: "web",
      shell: "browser",
    });
  });
});
