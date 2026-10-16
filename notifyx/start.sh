#!/usr/bin/env sh
# Optional convenience launcher for VPS / Termux. Hosting panels don't need it:
# they run `node index.js` themselves (and run `npm install` automatically).
set -e
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "[start.sh] Installing dependencies…"
  npm install --omit=dev --no-audit --no-fund
fi

if [ ! -f .env ] && [ -z "$DISCORD_TOKEN" ]; then
  echo "[start.sh] No .env file and no DISCORD_TOKEN in the environment. Copy .env.example to .env first." >&2
  exit 1
fi

exec node index.js
