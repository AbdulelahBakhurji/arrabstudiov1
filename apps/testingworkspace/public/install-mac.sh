#!/usr/bin/env bash
# Arrab Studio — build macOS .dmg on YOUR Mac
# Usage:
#   curl -fsSL https://testingworkspace.arrabai.com/install-mac.sh | bash
set -euo pipefail

APP_DIR="${HOME}/arrabstudiov1"
API_URL="https://api.arrabai.com"
REPO_URL="https://github.com/AbdulelahBakhurji/arrabstudiov1.git"

echo ""
echo "═══════════════════════════════════════"
echo "  Arrab Studio · macOS builder"
echo "═══════════════════════════════════════"
echo ""

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script only works on a Mac."
  exit 1
fi

# Xcode CLT
if ! xcode-select -p >/dev/null 2>&1; then
  echo "→ Installing Xcode Command Line Tools (a window may pop up)…"
  xcode-select --install || true
  echo "When the install finishes, run this script again."
  exit 1
fi

# Homebrew (optional but helpful for node)
if ! command -v brew >/dev/null 2>&1; then
  echo "→ Homebrew not found (optional). Continuing with Node if already installed…"
fi

# Node 22+
if ! command -v node >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    echo "→ Installing Node via Homebrew…"
    brew install node@22
    brew link --overwrite --force node@22 || true
  else
    echo "Install Node 22 from https://nodejs.org then re-run this script."
    exit 1
  fi
fi

NODE_MAJOR="$(node -v | sed 's/v//;s/\..*//')"
if [[ "$NODE_MAJOR" -lt 22 ]]; then
  echo "Node $(node -v) is too old. Need 22+. Update from https://nodejs.org"
  exit 1
fi

# Rust
if ! command -v rustc >/dev/null 2>&1; then
  echo "→ Installing Rust…"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
fi
# shellcheck disable=SC1091
source "$HOME/.cargo/env" 2>/dev/null || true

# Repo
if [[ -d "$APP_DIR/.git" ]]; then
  echo "→ Updating repo in $APP_DIR"
  git -C "$APP_DIR" fetch --all --prune
  git -C "$APP_DIR" pull --ff-only || true
else
  echo "→ Cloning into $APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

corepack enable >/dev/null 2>&1 || true
corepack prepare pnpm@10.15.1 --activate

mkdir -p apps/desktop
cat > apps/desktop/.env <<EOF
VITE_ARRAB_API_URL=${API_URL}
EOF

echo "→ Installing dependencies…"
pnpm install

echo "→ Building .dmg (this can take several minutes)…"
pnpm --filter @arrab/desktop exec tauri build --bundles dmg

DMG="$(find apps/desktop/src-tauri/target/release/bundle/dmg -name '*.dmg' 2>/dev/null | head -1 || true)"
if [[ -z "$DMG" ]]; then
  echo "Build finished but no .dmg was found. Check the log above."
  exit 1
fi

ABS="$(cd "$(dirname "$DMG")" && pwd)/$(basename "$DMG")"
echo ""
echo "═══════════════════════════════════════"
echo "  DONE"
echo "  $ABS"
echo "═══════════════════════════════════════"
echo ""
echo "Next:"
echo "  1) open \"$ABS\""
echo "  2) Drag Arrab Studio to Applications"
echo "  3) First launch: right-click → Open"
echo "  4) Sign in with your Arrab email/password"
echo "  5) Chat uses the same AI as the website"
echo ""
open "$(dirname "$ABS")" || true
