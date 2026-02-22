#!/usr/bin/env bash
set -euo pipefail

VER="${1:-5.3.0}"
URL="https://cdnjs.cloudflare.com/ajax/libs/fabric.js/${VER}/fabric.min.js"
OUT="frontend/vendor/fabric-${VER}.patched.min.js"

mkdir -p "$(dirname "$OUT")"
curl -fsSL -H "User-Agent: Mozilla/5.0" "$URL" | perl -pe 's/\balphabetical\b/alphabetic/g' > "$OUT"

echo "$OUT"
