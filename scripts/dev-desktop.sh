#!/usr/bin/env bash
# Reliable macOS Tauri launch. Prefer a known-good SDK when CLT ships a broken
# MacOSX27*.sdk with architectures the local linker does not understand.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PATH="${HOME}/.nvm/versions/node/$(cat .nvmrc 2>/dev/null || echo current)/bin:${PATH:-}"
if [[ -s "${HOME}/.nvm/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  . "${HOME}/.nvm/nvm.sh"
fi

if [[ "$(uname -s)" == "Darwin" ]]; then
  for sdk in \
    /Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk \
    /Library/Developer/CommandLineTools/SDKs/MacOSX15.sdk \
    /Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk \
    /Library/Developer/CommandLineTools/SDKs/MacOSX26.sdk
  do
    if [[ -d "$sdk" ]]; then
      export SDKROOT="$sdk"
      export MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-15.0}"
      break
    fi
  done
fi

exec pnpm --filter @arrab/desktop tauri:dev
