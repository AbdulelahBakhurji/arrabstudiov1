import pkg from "../../../package.json";
import { platformInfo } from "./platform-info";

/** Identifies this client to the API (device list, diagnostics, per-platform policy). Advisory only. */
export function clientInfoHeaders(): Record<string, string> {
  const info = platformInfo();
  const label: Record<string, string> = {
    macos: "macOS",
    windows: "Windows",
    linux: "Linux",
    ios: "iOS",
    android: "Android",
    huawei: "Huawei",
    web: "Browser",
  };
  return {
    "X-Arrab-Platform": info.os === "unknown" ? "web" : info.os,
    "X-Arrab-App-Version": String(pkg.version),
    "X-Arrab-Device-Name": `Arrab Studio on ${label[info.os] ?? "device"}`,
  };
}
