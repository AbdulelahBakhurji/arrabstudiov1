#!/usr/bin/env bash
# Legacy entrypoint — prefer: pnpm ship:mac
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
exec "$ROOT/scripts/build-mac.sh"
