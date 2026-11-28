#!/usr/bin/env bash
# Builds web.kolaba.app (Cloudflare Worker "kolaba-web", static assets): the web app at /, the admin panel at /admin/,
# the legal pages at /legal/. Then: cd cloudflare/web && npx wrangler deploy (wrangler from api/node_modules).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/cloudflare/web/public"
rm -rf "$OUT" && mkdir -p "$OUT"
cd "$ROOT/web" && npx tsc -p . && npx vite build --base / --outDir "$OUT" --emptyOutDir
cd "$ROOT/admin-web" && npx tsc -p . --noEmit && npx vite build --base /admin/ --outDir "$OUT/admin" --emptyOutDir
cp -R "$ROOT/legal" "$OUT/legal"
cp "$OUT/index.html" "$OUT/404.html"
cat > "$OUT/_headers" <<'HEADERS'
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
/admin/*
  X-Robots-Tag: noindex, nofollow
  X-Frame-Options: DENY
/app/*
  Cache-Control: public, max-age=31536000, immutable
HEADERS
echo "✓ built $OUT — deploy: cd cloudflare/web && ../../api/node_modules/.bin/wrangler deploy"
