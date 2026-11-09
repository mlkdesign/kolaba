#!/usr/bin/env bash
# Builds the admin panel into ../admin (served by GitHub Pages at /kolaba/admin/). Commit + push main to deploy.
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
touch ../.nojekyll
echo "✓ admin built into $(cd .. && pwd)/admin (commit and push main to deploy)"
