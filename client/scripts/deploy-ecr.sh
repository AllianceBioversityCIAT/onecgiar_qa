#!/usr/bin/env bash
# Build the Angular SSR image, push it to ECR and deploy the SAM application stack.
#
# Same flow on the first run and on every later run (idempotent):
#   1. ECR stack (infrastructure/ecr.yaml)        — create or no-op; repository is retained
#   2. docker build + push with a new, immutable tag
#   3. App stack (infrastructure/template.yaml)   — SAM transform applied by CloudFormation;
#      the new ImageUri is a stack parameter, so the function code never drifts
#   4. Termination protection on both stacks + CloudFront invalidation
#
# Run from any directory; paths are resolved relative to client/.
#
# Required env vars:
#   ENVIRONMENT              dev | staging | prod
#
# Optional:
#   DEPLOY_BRANCH            git branch being deployed; enforces prod ← main, staging ← staging
#   PROJECT_NAME             default: onecgiar-qa-frontend
#   AWS_REGION               default: us-east-1
#   IMAGE_TAG                default: <BUILD_NUMBER>-<git short sha>
#   ECR_STACK_NAME           default: ${PROJECT_NAME}-${ENVIRONMENT}-ecr
#   APP_STACK_NAME           default: ${PROJECT_NAME}-${ENVIRONMENT}
#   Only sent to CloudFormation when set (otherwise the stack keeps its current value):
#   SECRET_NAME, ADDITIONAL_ALLOWED_HOSTS, ENABLE_ORIGIN_ACCESS_CONTROL, MEMORY_SIZE, LAMBDA_TIMEOUT

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

ENVIRONMENT="${ENVIRONMENT:?ENVIRONMENT is required (dev | staging | prod)}"
PROJECT_NAME="${PROJECT_NAME:-onecgiar-qa-frontend}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ECR_STACK_NAME="${ECR_STACK_NAME:-${PROJECT_NAME}-${ENVIRONMENT}-ecr}"
APP_STACK_NAME="${APP_STACK_NAME:-${PROJECT_NAME}-${ENVIRONMENT}}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-}"

case "${ENVIRONMENT}" in
  dev | staging | prod) ;;
  *) echo "ENVIRONMENT must be dev, staging or prod (got '${ENVIRONMENT}')" >&2; exit 1 ;;
esac

# Second line of defence (Jenkins checks it too): protected environments only from their branch.
if [ "${ENVIRONMENT}" = "prod" ] && [ "${DEPLOY_BRANCH}" != "main" ]; then
  echo "Refusing to deploy prod from branch '${DEPLOY_BRANCH:-<unset>}' (only main)." >&2
  exit 1
fi
if [ "${ENVIRONMENT}" = "staging" ] && [ "${DEPLOY_BRANCH}" != "staging" ]; then
  echo "Refusing to deploy staging from branch '${DEPLOY_BRANCH:-<unset>}' (only staging)." >&2
  exit 1
fi

if [ -z "${IMAGE_TAG:-}" ]; then
  IMAGE_TAG="${BUILD_NUMBER:-manual}-$(git rev-parse --short HEAD)"
fi
if [ "${IMAGE_TAG}" = "latest" ]; then
  echo "IMAGE_TAG 'latest' is not allowed: the repository uses immutable tags." >&2
  exit 1
fi

TAGS=(
  "Project=${PROJECT_NAME}"
  "Environment=${ENVIRONMENT}"
  "ManagedBy=CloudFormation"
)

stack_output() {
  aws cloudformation describe-stacks \
    --region "${AWS_REGION}" \
    --stack-name "$1" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" \
    --output text
}

protect_stack() {
  aws cloudformation update-termination-protection \
    --region "${AWS_REGION}" \
    --stack-name "$1" \
    --enable-termination-protection >/dev/null
}

echo "==> [1/4] ECR stack: ${ECR_STACK_NAME}"
aws cloudformation deploy \
  --region "${AWS_REGION}" \
  --template-file infrastructure/ecr.yaml \
  --stack-name "${ECR_STACK_NAME}" \
  --no-fail-on-empty-changeset \
  --tags "${TAGS[@]}" \
  --parameter-overrides \
    "ProjectName=${PROJECT_NAME}" \
    "Environment=${ENVIRONMENT}"
protect_stack "${ECR_STACK_NAME}"

ECR_REPOSITORY_URI="$(stack_output "${ECR_STACK_NAME}" EcrRepositoryUri)"
ECR_REGISTRY="${ECR_REPOSITORY_URI%%/*}"
IMAGE_URI="${ECR_REPOSITORY_URI}:${IMAGE_TAG}"

echo "==> [2/4] Build and push ${IMAGE_URI}"
docker build -t "${IMAGE_URI}" .
aws ecr get-login-password --region "${AWS_REGION}" | \
  docker login --username AWS --password-stdin "${ECR_REGISTRY}"
docker push "${IMAGE_URI}"

APP_PARAMS=(
  "ProjectName=${PROJECT_NAME}"
  "Environment=${ENVIRONMENT}"
  "ImageUri=${IMAGE_URI}"
)
[ -n "${SECRET_NAME+x}" ] && APP_PARAMS+=("SecretName=${SECRET_NAME}")
[ -n "${ADDITIONAL_ALLOWED_HOSTS+x}" ] && APP_PARAMS+=("AdditionalAllowedHosts=${ADDITIONAL_ALLOWED_HOSTS}")
[ -n "${ENABLE_ORIGIN_ACCESS_CONTROL:-}" ] && APP_PARAMS+=("EnableOriginAccessControl=${ENABLE_ORIGIN_ACCESS_CONTROL}")
[ -n "${MEMORY_SIZE:-}" ] && APP_PARAMS+=("MemorySize=${MEMORY_SIZE}")
[ -n "${LAMBDA_TIMEOUT:-}" ] && APP_PARAMS+=("Timeout=${LAMBDA_TIMEOUT}")

echo "==> [3/4] App stack (SAM): ${APP_STACK_NAME}"
aws cloudformation deploy \
  --region "${AWS_REGION}" \
  --template-file infrastructure/template.yaml \
  --stack-name "${APP_STACK_NAME}" \
  --capabilities CAPABILITY_NAMED_IAM CAPABILITY_AUTO_EXPAND \
  --no-fail-on-empty-changeset \
  --tags "${TAGS[@]}" \
  --parameter-overrides "${APP_PARAMS[@]}"
protect_stack "${APP_STACK_NAME}"

echo "==> [4/4] CloudFront invalidation"
CLOUDFRONT_DISTRIBUTION_ID="$(stack_output "${APP_STACK_NAME}" CloudFrontDistributionId)"
aws cloudfront create-invalidation \
  --distribution-id "${CLOUDFRONT_DISTRIBUTION_ID}" \
  --paths '/*' >/dev/null

aws cloudformation describe-stacks \
  --region "${AWS_REGION}" \
  --stack-name "${APP_STACK_NAME}" \
  --query 'Stacks[0].Outputs' \
  --output table

echo "Deploy complete: ${IMAGE_URI}"
