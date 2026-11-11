#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

NODE=${NODE:-node}
if ! command -v "$NODE" >/dev/null 2>&1; then
  echo "node not found; install Node.js >= 20" >&2
  exit 1
fi
"$NODE" -v

if [ ! -d node_modules/pngjs ] || [ ! -d node_modules/qrcode ] || [ ! -d node_modules/@tencent-connect ]; then
  echo "installing dependencies..."
  npm install --omit=dev --registry https://registry.npmmirror.com
fi

export NODE_ENV=${NODE_ENV:-production}
exec "$NODE" server.mjs