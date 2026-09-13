#!/usr/bin/env bash
# Build Arrab Studio .dmg on a Mac (cannot be done on the Linux API server).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

echo "==> Node $(node -v 2>/dev/null || echo missing)"
echo "==> Using API: ${VITE_ARRAB_API_URL:-https://api.arrabai.com}"

if ! command -v node >/dev/null; then
  echo "Install Node 22+ from https://nodejs.org then re-run."
  exit 1
fi
if ! command -v rustc >/dev/null; then
  echo "Installing Rust…"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi
if ! xcode-select -p >/dev/null 2>&1; then
  echo "Install Xcode Command Line Tools: xcode-select --install"
  exit 1
fi

corepack enable
corepack prepare pnpm@10.15.1 --activate

mkdir -p apps/desktop
cat > apps/desktop/.env <<EOF
VITE_ARRAB_API_URL=${VITE_ARRAB_API_URL:-https://api.arrabai.com}
EOF

pnpm install
pnpm --filter @arrab/desktop exec tauri build --bundles dmg

echo
echo "Done. Installer:"
find apps/desktop/src-tauri/target/release/bundle -name '*.dmg' -print
echo
echo "First open on Mac (unsigned): right-click the app → Open"
echo "Or: xattr -cr \"/Applications/Arrab Studio.app\""
