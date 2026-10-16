#!/usr/bin/env bash
# Refreshes public/apicurio-editor from Apicurio Registry's UI image, which ships the prebuilt
# Apicurio OpenAPI editor in /opt/app-root/src/editors. Needs Docker.
#   scripts/update-apicurio-editor.sh [image]     (default below)
set -euo pipefail
image="${1:-apicurio/apicurio-registry-ui:3.3}"
target="$(cd "$(dirname "$0")/.." && pwd)/public/apicurio-editor"
work="$(mktemp -d)"
trap 'rm -rf "$work"; docker rm -f echo-apicurio-copy >/dev/null 2>&1 || true' EXIT

docker pull -q "$image" >/dev/null
docker create --name echo-apicurio-copy "$image" >/dev/null
docker cp echo-apicurio-copy:/opt/app-root/src/editors "$work/editors"

# Browsers use the woff/woff2 fonts; the svg/eot/ttf copies and the login backgrounds are not needed.
find "$work/editors" \( -name '*.svg' -o -name '*.eot' -o -name '*.ttf' -o -name 'pfbg_*.jpg' \) -delete

find "$target" -mindepth 1 ! -name README.md -delete
cp -r "$work/editors/." "$target/"
echo "Updated $target from $image"
