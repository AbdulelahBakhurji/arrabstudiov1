#!/usr/bin/env bash
set -euo pipefail
# Publish a Studio installer into the testing workspace download page.
# Usage: ./apps/testingworkspace/publish-release.sh /path/to/ArrabStudio-0.1.0.dmg

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <installer.dmg|.deb|.AppImage|.exe>" >&2
  exit 1
fi

src="$1"
if [[ ! -f "$src" ]]; then
  echo "File not found: $src" >&2
  exit 1
fi

dest_dir="/var/www/testingworkspace/releases"
mkdir -p "$dest_dir"
cp -f "$src" "$dest_dir/"
chown www-data:www-data "$dest_dir/$(basename "$src")"
chmod a+r "$dest_dir/$(basename "$src")"
echo "Published $(basename "$src") → https://testingworkspace.arrabai.com/releases/$(basename "$src")"
