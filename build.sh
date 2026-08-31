#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
npm install
cd webapp && npm install && npm run build && cd ..
npm run build:extension
npx --yes @vscode/vsce package --no-dependencies --allow-missing-repository -o dist/cockroachlabs-blast-0.1.0.vsix
echo "Packaged dist/cockroachlabs-blast-0.1.0.vsix"
