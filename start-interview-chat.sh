#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22.13 or newer is required: https://nodejs.org/"
  exit 1
fi

node -e 'const [major,minor]=process.versions.node.split(".").map(Number);process.exit(major>22 || (major===22 && minor>=13) ? 0 : 1)' || {
  echo "Node.js 22.13 or newer is required. Current version: $(node --version)"
  exit 1
}

if [ ! -f node_modules/@openai/codex/bin/codex.js ]; then
  echo "Installing local dependencies. This happens only on the first run..."
  npm ci
fi

npm run local:open
