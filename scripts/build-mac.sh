#!/usr/bin/env bash
# Build Arrab Studio for macOS → .app + .dmg.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/lib/common.sh"

cd "$ROOT"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS builds must run on a Mac."
  exit 1
fi

ensure_node
ensure_rust
ensure_pnpm

if ! xcode-select -p >/dev/null 2>&1; then
  echo "Install Xcode Command Line Tools: xcode-select --install"
  exit 1
fi

# Prefer a known-good SDK when CLT ships a broken MacOSX27* SDK.
for sdk in \
  /Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk \
  /Library/Developer/CommandLineTools/SDKs/MacOSX15.sdk \
  /Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk \
  /Library/Developer/CommandLineTools/SDKs/MacOSX26.sdk
do
  if [[ -d "$sdk" ]]; then
    export SDKROOT="$sdk"
    export MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-12.0}"
    break
  fi
done

sync_desktop_version
prepare_desktop_env

echo ""
echo "═══════════════════════════════════════"
echo "  Arrab Studio · macOS package"
echo "  version $(read_version)"
echo "═══════════════════════════════════════"
echo ""

pnpm install

BUNDLES="${ARRAB_MAC_BUNDLES:-app,dmg}"
TAURI_ARGS=(build --bundles "$BUNDLES")
if [[ "${ARRAB_UNIVERSAL:-0}" == "1" ]]; then
  rustup target add aarch64-apple-darwin x86_64-apple-darwin >/dev/null
  TAURI_ARGS+=(--target universal-apple-darwin)
  echo "Building universal binary (Intel + Apple Silicon)…"
fi

# Optional Developer ID signing
if [[ -n "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  export APPLE_SIGNING_IDENTITY
  echo "Signing with: $APPLE_SIGNING_IDENTITY"
fi

# Signed in-app updates: only when the minisign private key is provided by CI / the shell.
# The key never lives in the repo (see docs/MANAGED_CLIENT.md → Updater keys).
if [[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  export TAURI_SIGNING_PRIVATE_KEY
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"
  TAURI_ARGS+=(--config '{"bundle":{"createUpdaterArtifacts":true}}')
  echo "Creating signed updater artifacts."
fi

pnpm --filter @arrab/desktop exec tauri "${TAURI_ARGS[@]}"

collect_artifacts

if [[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  VERSION="$(read_version)"
  OUT="$ROOT/release/artifacts/v$VERSION"
  REPO_URL="${ARRAB_RELEASE_BASE_URL:-https://github.com/AbdulelahBakhurji/arrabstudiov1/releases/download/v$VERSION}"
  if [[ "${ARRAB_UNIVERSAL:-0}" == "1" ]]; then
    BUNDLE_DIR="$ROOT/apps/desktop/src-tauri/target/universal-apple-darwin/release/bundle/macos"
    ARCHES=(aarch64 x86_64)
  else
    BUNDLE_DIR="$ROOT/apps/desktop/src-tauri/target/release/bundle/macos"
    [[ "$(uname -m)" == "arm64" ]] && ARCHES=(aarch64) || ARCHES=(x86_64)
  fi
  TARBALL="$(find "$BUNDLE_DIR" -maxdepth 1 -name '*.app.tar.gz' -print -quit 2>/dev/null || true)"
  if [[ -n "$TARBALL" && -f "$TARBALL.sig" ]]; then
    mkdir -p "$OUT"
    ASSET="Arrab-Studio_${VERSION}_macos.app.tar.gz"
    cp "$TARBALL" "$OUT/$ASSET"
    cp "$TARBALL.sig" "$OUT/$ASSET.sig"
    node -e '
      const [out, version, url, sigPath, ...arches] = process.argv.slice(1);
      const fs = require("fs");
      const signature = fs.readFileSync(sigPath, "utf8").trim();
      const platforms = Object.fromEntries(arches.map((a) => [`darwin-${a}`, { signature, url }]));
      fs.writeFileSync(`${out}/latest.json`, JSON.stringify({
        version, notes: `Arrab Studio ${version}`, pub_date: new Date().toISOString(), platforms,
      }, null, 2) + "\n");
    ' "$OUT" "$VERSION" "$REPO_URL/$ASSET" "$OUT/$ASSET.sig" "${ARCHES[@]}"
    echo "  Updater: $OUT/latest.json"
  else
    echo "  Updater artifacts not found — skipped latest.json."
  fi
fi

APP_PATH="$(find "$ROOT/apps/desktop/src-tauri/target/release/bundle/macos" -maxdepth 1 -name '*.app' -print -quit 2>/dev/null || true)"
DMG_PATH="$(find "$ROOT/apps/desktop/src-tauri/target/release/bundle/dmg" -name '*.dmg' -print -quit 2>/dev/null || true)"

echo ""
echo "Done."
[[ -n "$APP_PATH" ]] && echo "  App: $APP_PATH"
[[ -n "$DMG_PATH" ]] && echo "  DMG: $DMG_PATH"
echo "  Collected: release/artifacts/v$(read_version)/"
echo ""
echo "Install locally:"
echo "  open \"$DMG_PATH\""
echo "First launch if unsigned: right-click Arrab Studio → Open"
echo "  or: xattr -cr \"/Applications/Arrab Studio.app\""
