#!/bin/bash
# Installs npm dependencies at the start of Claude Code cloud sessions so
# typecheck, lint, Vitest and Playwright work immediately. Local sessions skip it.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# The container ships Chromium for Playwright; never download browsers here.
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
export EXPO_NO_TELEMETRY=1

# npm install (not npm ci) reuses the cached node_modules from the container
# snapshot; it still honors package-lock.json exactly.
npm install --no-audit --no-fund --loglevel=error

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    echo 'export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1'
    echo 'export EXPO_NO_TELEMETRY=1'
    # expo install must read the SDK's bundled version list; api.expo.dev is blocked here.
    echo 'export EXPO_OFFLINE=1'
  } >> "$CLAUDE_ENV_FILE"
fi
