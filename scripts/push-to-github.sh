#!/usr/bin/env bash
# Push workspace changes to GitHub
# Usage: bash scripts/push-to-github.sh [commit-message] [branch]
# Requires: GITHUB_TOKEN secret in Replit

set -e

REPO="imanuelmantiri18-droid/Algo-Strategy-Lab"
BRANCH="${2:-main}"
COMMIT_MSG="${1:-chore: update from Replit workspace [$(date '+%Y-%m-%d %H:%M')]}"

if [ -z "$GITHUB_TOKEN" ]; then
  echo "❌ GITHUB_TOKEN is not set. Add it to Replit Secrets."
  exit 1
fi

echo "▶ Configuring git identity..."
git config user.email "replit-agent@replit.com"
git config user.name "Replit Agent"
git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@github.com/${REPO}.git" 2>/dev/null \
  || git remote add origin "https://x-access-token:${GITHUB_TOKEN}@github.com/${REPO}.git"

echo "▶ Staging all changes..."
git add -A

if git diff --cached --quiet; then
  echo "ℹ️  Nothing to commit — working tree is clean."
  exit 0
fi

echo "▶ Committing: $COMMIT_MSG"
git commit -m "$COMMIT_MSG"

echo "▶ Pushing to branch: $BRANCH"
git push origin HEAD:"$BRANCH"
echo "✅ Pushed to github.com/${REPO} (branch: $BRANCH)"
