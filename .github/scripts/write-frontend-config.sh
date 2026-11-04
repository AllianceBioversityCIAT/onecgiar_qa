#!/usr/bin/env bash
# Writes the OneCGIAR QA DEV frontend configuration from Secrets Manager, as the Jenkins DEV job does (devops
# PIPES/PRMS/V2/QA-2026/dev-complete/Jenkinsfile, stage 'Generate Frontend Environments'): ONE read of the secret
# to environment.ts, copied to environment.qatest.ts (compiled by `--configuration test`) and to
# environment.development.ts (`ng test` builds with build:development).
# Adapted from onecgiar_pr .github/scripts/write-frontend-config.sh (Reporting Tool DEV): QA file names, and no
# "git-ignored" guard, because these files are still versioned on some QA branches (the legacy job overwrites them
# too); remove-frontend-config.sh restores a versioned file or deletes a generated one.
#
# The value goes from the AWS CLI straight to the files: it is never echoed and never a step or job output;
# only its string literals are read back to register log masks. Files are mode 0600 and removed by the
# workflow's `if: always()` step (remove-frontend-config.sh).
# Inputs (environment): SECRET_ID, AWS_REGION and the step-scoped temporary credentials.
set -euo pipefail
: "${SECRET_ID:?}" "${AWS_REGION:?}"

dir="client/src/environments"
main="$dir/environment.ts"
copies=("$dir/environment.qatest.ts" "$dir/environment.development.ts")

[ -f "$dir/environment.model.ts" ] || { echo "::error::$dir/environment.model.ts not found (fail closed)"; exit 1; }

umask 077
if ! aws secretsmanager get-secret-value --region "$AWS_REGION" --secret-id "$SECRET_ID" \
       --query SecretString --output text > "$main" 2> /dev/null; then
  rm -f "$main"
  # The CLI error is not printed: it may quote request details. The id is a non-secret variable.
  echo "::error::could not read the frontend configuration secret (check the build role and the secret id)"
  exit 1
fi
if [ ! -s "$main" ]; then
  rm -f "$main"
  echo "::error::the frontend configuration secret is empty (fail closed)"
  exit 1
fi
for f in "${copies[@]}"; do cp "$main" "$f"; done

# Defense in depth only (the protection is that nothing prints the files): register every quoted string
# value of 8+ characters as a log mask, so an accidental echo in a later step of this job shows `***`.
# Workflow commands are consumed by the runner and never shown in the log.
masked=0
while IFS= read -r value; do
  value="${value%%[\'\"]}"; value="${value#[\'\"]}"
  value="${value//'%'/'%25'}"
  [ "${#value}" -ge 8 ] || continue
  echo "::add-mask::${value}"
  masked=$((masked + 1))
done < <(grep -oE "'[^'\\\\]{8,}'|\"[^\"\\\\]{8,}\"" "$main" || true)

echo "frontend configuration written (3 files, mode 0600, ${masked} values masked)"
