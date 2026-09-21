#!/usr/bin/env bash
# Shared helpers for Arrab Studio desktop packaging.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export ROOT

ensure_node() {
  if ! command -v node >/dev/null 2>&1; then
    echo "Node.js 22+ is required. Install from https://nodejs.org"
    exit 1
  fi
  # shellcheck disable=SC1091
  if [[ -s "${HOME}/.nvm/nvm.sh" ]]; then
    . "${HOME}/.nvm/nvm.sh"
  fi
  export PATH="${HOME}/.cargo/bin:${PATH:-}"
}

ensure_rust() {
  if ! command -v rustc >/dev/null 2>&1; then
    echo "Installing Rust toolchain…"
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    # shellcheck disable=SC1091
    . "${HOME}/.cargo/env"
  fi
  export PATH="${HOME}/.cargo/bin:${PATH:-}"
}

ensure_pnpm() {
  if ! command -v pnpm >/dev/null 2>&1; then
    corepack enable
    corepack prepare pnpm@10.15.1 --activate
  fi
}

read_version() {
  node -e "console.log(require('$ROOT/package.json').version)"
}

sync_desktop_version() {
  local version
  version="$(read_version)"
  node <<NODE
const fs = require("fs");
const path = require("path");
const root = process.env.ROOT;
const version = "$version";

const tauriPath = path.join(root, "apps/desktop/src-tauri/tauri.conf.json");
const tauri = JSON.parse(fs.readFileSync(tauriPath, "utf8"));
tauri.version = version;
fs.writeFileSync(tauriPath, JSON.stringify(tauri, null, 2) + "\n");

const cargoPath = path.join(root, "apps/desktop/src-tauri/Cargo.toml");
let cargo = fs.readFileSync(cargoPath, "utf8");
cargo = cargo.replace(/^version = ".*"$/m, \`version = "\${version}"\`);
fs.writeFileSync(cargoPath, cargo);

const deskPkgPath = path.join(root, "apps/desktop/package.json");
const deskPkg = JSON.parse(fs.readFileSync(deskPkgPath, "utf8"));
deskPkg.version = version;
fs.writeFileSync(deskPkgPath, JSON.stringify(deskPkg, null, 2) + "\n");

console.log("Synced desktop version →", version);
NODE
}

prepare_desktop_env() {
  local api_url="${VITE_ARRAB_API_URL:-https://api.arrabai.com}"
  mkdir -p "$ROOT/apps/desktop"
  if [[ ! -f "$ROOT/apps/desktop/.env" ]]; then
    cat > "$ROOT/apps/desktop/.env" <<EOF
VITE_ARRAB_API_URL=${api_url}
EOF
  fi
  echo "Desktop API → ${api_url}"
}

collect_artifacts() {
  local version out bundle
  version="$(read_version)"
  out="$ROOT/release/artifacts/v${version}"
  bundle="$ROOT/apps/desktop/src-tauri/target/release/bundle"
  mkdir -p "$out"
  if [[ -d "$bundle" ]]; then
    find "$bundle" -type f \( \
      -name "*.dmg" -o -name "*.app" -o -name "*.exe" -o -name "*.msi" -o -name "*.AppImage" \
    \) -print0 2>/dev/null | while IFS= read -r -d "" file; do
      cp -R "$file" "$out/" 2>/dev/null || true
    done
    # macOS .app is a directory
    find "$bundle/macos" -maxdepth 1 -type d -name "*.app" -print0 2>/dev/null | while IFS= read -r -d "" app; do
      rm -rf "$out/$(basename "$app")"
      cp -R "$app" "$out/"
    done
  fi
  echo "Artifacts:"
  find "$out" -maxdepth 2 \( -type f -o -name "*.app" \) | sort
}
