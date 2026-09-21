#!/usr/bin/env bash
# Build Arrab Studio for Windows → NSIS (.exe) + MSI.
# Must run on Windows (or windows-latest CI). Cross-compile from macOS is not supported here.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/lib/common.sh"

cd "$ROOT"

ensure_node
ensure_rust
ensure_pnpm
sync_desktop_version
prepare_desktop_env

echo ""
echo "═══════════════════════════════════════"
echo "  Arrab Studio · Windows package"
echo "  version $(read_version)"
echo "═══════════════════════════════════════"
echo ""

if [[ "$(uname -s)" == "Darwin" || "$(uname -s)" == "Linux" ]]; then
  echo "Windows installers must be built on Windows."
  echo "Use GitHub Actions (desktop-release.yml) or a Windows machine:"
  echo "  pnpm ship:windows"
  exit 1
fi

pnpm install

BUNDLES="${ARRAB_WIN_BUNDLES:-nsis,msi}"
pnpm --filter @arrab/desktop exec tauri build --bundles "$BUNDLES"

collect_artifacts

echo ""
echo "Done. Artifacts in release/artifacts/v$(read_version)/"
