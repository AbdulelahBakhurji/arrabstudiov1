#!/usr/bin/env bash
# Publish desktop installers + signed updater artifacts to GitHub Releases.
# Usage:
#   scripts/publish-github-release.sh [version]
# Env:
#   GH_TOKEN or gh auth session required.
#   ARRAB_RELEASE_REPO (default: AbdulelahBakhurji/arrabstudiov1)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/lib/common.sh"

cd "$ROOT"

VERSION="${1:-$(read_version)}"
VERSION="${VERSION#v}"
TAG="v${VERSION}"
OUT="$ROOT/release/artifacts/v${VERSION}"
REPO="${ARRAB_RELEASE_REPO:-AbdulelahBakhurji/arrabstudiov1}"

if [[ ! -d "$OUT" ]]; then
  echo "Missing artifacts dir: $OUT"
  echo "Run: pnpm ship:mac  (with TAURI_SIGNING_PRIVATE_KEY set)"
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is required."
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "Not logged into GitHub CLI."
  echo "Run: gh auth login"
  echo "Or set GH_TOKEN with repo release permissions."
  exit 1
fi

shopt -s nullglob
FILES=(
  "$OUT"/*.dmg
  "$OUT"/*.app.tar.gz
  "$OUT"/*.app.tar.gz.sig
  "$OUT"/latest.json
  "$OUT"/*.exe
  "$OUT"/*.msi
)
shopt -u nullglob

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "No uploadable files in $OUT"
  exit 1
fi

if [[ ! -f "$OUT/latest.json" ]]; then
  echo "WARN: latest.json missing — Tauri updater endpoint will 404 until it is uploaded."
fi

echo "Publishing $TAG to $REPO"
echo "Files:"
printf '  %s\n' "${FILES[@]}"

if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  gh release upload "$TAG" "${FILES[@]}" --repo "$REPO" --clobber
  echo "Updated assets on existing release $TAG"
else
  gh release create "$TAG" "${FILES[@]}" \
    --repo "$REPO" \
    --title "Arrab Studio ${TAG}" \
    --notes "Arrab Studio ${VERSION} — installers and signed updater (latest.json)."
  echo "Created release $TAG"
fi

echo ""
echo "Updater URL:"
echo "  https://github.com/${REPO}/releases/latest/download/latest.json"
echo "Done."
