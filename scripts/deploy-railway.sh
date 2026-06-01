#!/usr/bin/env bash
# Deploy to Railway via GitHub push (triggers auto-deploy)
# Usage: bash scripts/deploy-railway.sh [commit-message]
# Requires: GITHUB_TOKEN and RAILWAY_TOKEN secrets

set -e

if [ -z "$RAILWAY_TOKEN" ]; then
  echo "❌ RAILWAY_TOKEN is not set. Add it to Replit Secrets."
  exit 1
fi

COMMIT_MSG="${1:-deploy: update from Replit [$(date '+%Y-%m-%d %H:%M')]}"

echo "▶ Step 1: Push code to GitHub (this triggers Railway auto-deploy)..."
bash "$(dirname "$0")/push-to-github.sh" "$COMMIT_MSG"

echo ""
echo "▶ Step 2: Triggering Railway deployment via API..."
RESPONSE=$(curl -s -X POST "https://backboard.railway.app/graphql/v2" \
  -H "Authorization: Bearer ${RAILWAY_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ me { id name email } }"}')

echo "Railway API response: $RESPONSE"

echo ""
echo "✅ Deployment triggered!"
echo "   Monitor at: https://railway.app/dashboard"
echo "   Live bot command: tsx src/scripts/live-bot.ts --strategy=fractal_breakout --interval=1h --leverage=20 --risk=10 --capital=100 --symbol=BTCUSDT"
