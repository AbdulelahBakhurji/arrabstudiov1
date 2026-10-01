import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { StudioRelease, StudioReleasesResponse } from "@arrab/shared";

function classify(filename: string): Pick<StudioRelease, "platform" | "kind"> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".dmg")) {
    return { platform: "macos", kind: "dmg" };
  }
  if (lower.endsWith(".pkg")) {
    return { platform: "macos", kind: "pkg" };
  }
  if (lower.endsWith(".appimage")) {
    return { platform: "linux", kind: "AppImage" };
  }
  if (lower.endsWith(".deb")) {
    return { platform: "linux", kind: "deb" };
  }
  if (lower.endsWith(".rpm")) {
    return { platform: "linux", kind: "rpm" };
  }
  if (lower.endsWith(".exe") || lower.endsWith(".msi")) {
    return { platform: "windows", kind: lower.endsWith(".msi") ? "msi" : "exe" };
  }
  return { platform: "other", kind: path.extname(filename).replace(".", "") || "file" };
}

function versionFromName(filename: string): string | null {
  const match = filename.match(/(\d+\.\d+\.\d+)/);
  return match?.[1] ?? null;
}

export async function listStudioReleases(
  releasesDir: string,
  publicBaseUrl: string,
): Promise<StudioReleasesResponse> {
  let names: string[] = [];
  try {
    names = await readdir(releasesDir);
  } catch {
    return { items: [], latestMacDmg: null };
  }

  const items: StudioRelease[] = [];
  for (const filename of names) {
    if (filename.startsWith(".")) {
      continue;
    }
    if (filename === "index.html" || filename.endsWith(".json")) {
      continue;
    }
    const full = path.join(releasesDir, filename);
    let info;
    try {
      info = await stat(full);
    } catch {
      continue;
    }
    if (!info.isFile()) {
      continue;
    }
    const { platform, kind } = classify(filename);
    items.push({
      id: filename,
      filename,
      url: `${publicBaseUrl.replace(/\/$/, "")}/releases/${encodeURIComponent(filename)}`,
      platform,
      kind,
      version: versionFromName(filename),
      sizeBytes: info.size,
      updatedAt: info.mtime.toISOString(),
    });
  }

  items.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const latestMacDmg =
    items.find((item) => item.platform === "macos" && item.kind === "dmg") ?? null;
  return { items, latestMacDmg };
}
