#!/bin/sh
# Start the AI Department chat server (Linux / macOS).
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "Node.js is not installed. Get the LTS version from https://nodejs.org"; exit 1; }
exec node server.js
