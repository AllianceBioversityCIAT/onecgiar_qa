#!/usr/bin/env bash
# Removes the frontend DEV configuration written by write-frontend-config.sh and the build cache that may hold
# transformed copies of it (Angular's build cache). A file still versioned on this branch is restored from git
# (as the legacy job did); a generated one is deleted. Runs as an `if: always()` step, so it also runs when a
# previous step failed. Never fails the job.
# Adapted from onecgiar_pr .github/scripts/remove-frontend-config.sh (Reporting Tool DEV): QA file names.
set -uo pipefail
client="client"
for f in environment.ts environment.qatest.ts environment.development.ts; do
  path="$client/src/environments/$f"
  if git ls-files --error-unmatch "$path" > /dev/null 2>&1; then
    git checkout -- "$path" 2> /dev/null || rm -f "$path"
  else
    rm -f "$path"
  fi
done
rm -rf "$client/.angular"
echo "frontend configuration and caches removed"
