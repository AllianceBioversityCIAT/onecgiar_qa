#!/usr/bin/env bash
# Refresh the copy of the AI worker contract (spec assessment/ai-suggestions, T-2).
# Usage: scripts/sync-ai-contract.sh <path to ai-qa-helper>
# Copies contract/schema, contract/examples and production.json, then writes
# manifest.json (sha256 per file + the worker commit). Update
# src/ai-suggestions/production.ts by hand if production.json changed: the
# contract test fails until both agree.
set -euo pipefail
src="${1:?path to ai-qa-helper}"
dst="$(cd "$(dirname "$0")/.." && pwd)/src/ai-suggestions/contract"
rm -rf "$dst/schema" "$dst/examples"
mkdir -p "$dst/schema" "$dst/examples"
cp "$src"/contract/schema/*.json "$dst/schema/"
cp "$src"/contract/examples/*.json "$dst/examples/"
cp "$src"/contract/production.json "$dst/"
commit="$(git -C "$src" rev-parse --short HEAD)"
branch="$(git -C "$src" rev-parse --abbrev-ref HEAD)"
cd "$dst"
{
  printf '{\n  "source": "ai-services/ai-qa-helper",\n  "branch": "%s",\n  "commit": "%s",\n  "files": {\n' "$branch" "$commit"
  first=1
  for f in production.json schema/*.json examples/*.json; do
    [ $first -eq 1 ] || printf ',\n'
    first=0
    printf '    "%s": "%s"' "$f" "$(shasum -a 256 "$f" | cut -d' ' -f1)"
  done
  printf '\n  }\n}\n'
} > manifest.json
echo "contract synced from $branch@$commit"
