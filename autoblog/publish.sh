#!/usr/bin/env bash
# Publish helper — run this after merging an autoblog PR (or any change) to push
# the current main branch live to Vercel production.
#
# Why this exists: Vercel's git integration isn't linked to this project (the
# Vercel GitHub App hasn't been granted access to the private repo), so a merge
# to main does NOT auto-deploy. This script does the deploy via the authenticated
# Vercel CLI instead — one command, fully reliable.
#
# Usage:   bash autoblog/publish.sh
set -euo pipefail
cd "$(dirname "$0")/.."
echo "→ syncing local main with GitHub…"
git checkout main
git pull --ff-only origin main
echo "→ deploying to Vercel production…"
npx vercel@latest deploy --prod --yes
echo "✓ Published. Live at https://dentalmarketingpros.co.uk"
