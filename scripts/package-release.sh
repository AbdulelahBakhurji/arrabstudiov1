#!/usr/bin/env bash
# Sync version and package the current platform's desktop installers.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/lib/common.sh"

cd "$ROOT"
ensure_node
sync_desktop_version

case "$(uname -s)" in
  Darwin)
    exec "$SCRIPT_DIR/build-mac.sh"
    ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    exec "$SCRIPT_DIR/build-windows.sh"
    ;;
  *)
    echo "Unsupported host for desktop packaging: $(uname -s)"
    echo "Use macOS for .dmg/.app or Windows for NSIS/MSI (or GitHub Actions)."
    exit 1
    ;;
esac
