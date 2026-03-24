#!/bin/sh
# Ensure native dependencies are installed before starting the MCP server.
# better-sqlite3 is a C++ addon that can't be bundled — it must be compiled
# on the user's machine after plugin download.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! node -e "require('$SCRIPT_DIR/node_modules/better-sqlite3')" 2>/dev/null; then
  npm install --prefix "$SCRIPT_DIR" --silent 2>/dev/null
fi

exec node "$SCRIPT_DIR/dist/bundle.mjs"
