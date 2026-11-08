#!/usr/bin/env bash
# Builds the web app and places it at the repo root, where GitHub Pages (branch main, folder /) serves it.
# The iPhone mockup (assets/iphone.png, the shell in web/index.html) is part of the build.
set -euo pipefail
WEB="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$WEB/.." && pwd)"
cd "$WEB"
npx tsc -p .
npx vite build
cd "$ROOT"
rm -rf app icons fonts demo index.html 404.html
cp -R "$WEB/dist/." "$ROOT/"
cp index.html 404.html
touch .nojekyll
echo "✓ published build to $ROOT (commit and push main to deploy)"
