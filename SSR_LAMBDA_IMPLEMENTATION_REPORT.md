# SSR on AWS Lambda — implementation report (QA frontend)

- **Branch:** `feature/qa-ssr-lambda`, created from `origin/jp-design/mockup-completo` @ `ab04612`. The base branch was not modified.
- **Reference:** `onecgiar-ibd-platform`, branch `dev` @ `9931259` (read only).
- **Scope:** prepare `client/` so the Angular SSR frontend can be deployed to AWS Lambda with SAM, plus a local Jenkinsfile. Jenkins setup, AWS resources, deployments and infrastructure tests are done by the repo owner.
- **Not done:** commits, push, deployments, Jenkins configuration.

## 1. Reference architecture (IBD)

```
Viewer → CloudFront (CachingDisabled, AllViewerExceptHostHeader) → Lambda Function URL → Lambda (container image)
                                                                         ├─ AWS Lambda Web Adapter (/opt/extensions)
                                                                         └─ Node HTTP server (Astro, @astrojs/node standalone)
Jenkins → scripts/deploy-ecr.sh → ECR push → CloudFormation / lambda update-function-code → CloudFront invalidation
```

The IBD repo uses a single CloudFormation template with a `DeployApp` switch, a public Function URL, a Secrets Manager loader in the app, and a Jenkinsfile kept out of git.

## 2. Final architecture for QA

```
Viewer ──https──> CloudFront ──https──> Lambda Function URL ──> Lambda "onecgiar-qa-frontend-<env>"
                  (CachingDisabled,      (AuthType NONE by default;    ├─ Lambda Web Adapter 0.9.1
                   AllViewerExcept-       AWS_IAM + OAC if enabled)    └─ node dist/onecgiar-qa/server/server.mjs
                   HostHeader)                                             (Angular 22 SSR, Express, PORT 8080)
Stack 1  <project>-<env>-ecr   infrastructure/ecr.yaml       ECR repository (Retain, immutable tags)
Stack 2  <project>-<env>       infrastructure/template.yaml  SAM: Lambda, role, logs, Function URL, permissions, CloudFront, OAC (optional)
```

- **No application code changes.** The existing `src/server.ts` already starts an Express server on `PORT`.
- **Rendering modes stay as they are:** `/login` is prerendered and the other routes render client-side.
- **`NG_ALLOWED_HOSTS` is mandatory.** Without it, Angular 22 answers **400** to every rendered route (verified locally). The template sets it to `*.lambda-url.<region>.on.aws` (plus any optional extra hosts), because CloudFront forwards the Function URL host.
- **`NG_TRUST_PROXY_HEADERS=x-forwarded-for,x-forwarded-proto,x-forwarded-port`.** SSR sees the real `https` URL, and the logs no longer show one proxy-header warning per request.
- **The runtime image has no `node_modules`.** The Angular builder bundles `express` and `@angular/ssr` into `server.mjs`, so only `dist/onecgiar-qa` is copied.

## 3. Files

| File | Status | Purpose |
|-|-|-|
| `client/Dockerfile` | new | Build stage (`npm ci` + `ng build`) → `node:22-alpine` + Lambda Web Adapter 0.9.1. `PORT`/`AWS_LWA_PORT` 8080, readiness check on `/favicon.ico` (a static file, so the host check doesn't apply). |
| `client/.dockerignore` | new | Build context without `node_modules`, `dist`, `.env*`, infrastructure, scripts and docs. |
| `client/infrastructure/ecr.yaml` | new | ECR stack. |
| `client/infrastructure/template.yaml` | new | SAM application stack. |
| `client/scripts/deploy-ecr.sh` | new | Single idempotent deploy script: it does both the first deployment and every later one. |
| `client/Jenkinsfile` | new, **local only** | IBD-style pipeline. |
| `client/.gitignore` | modified (+3 lines) | Adds `/Jenkinsfile`. |
| `SSR_LAMBDA_IMPLEMENTATION_REPORT.md` | new | This report. |

Two files from the first pass were deleted; both were untracked and created in this work: `client/infrastructure/cloudformation.yaml`, replaced by the two stacks, and `client/scripts/bootstrap-infra.sh`, now covered by `deploy-ecr.sh`.

No changes were made to `package.json`, `angular.json`, `tsconfig*`, `app.config*`, `src/**`, `server/**`, auth, or the reference repo.

## 4. Second review — changes made

1. **Jenkinsfile in the IBD structure**, kept local and ignored by git (§7).
2. **Infrastructure migrated to SAM with two stacks.** The `DeployApp` switch is gone, so a later deploy can no longer remove the Lambda or CloudFront by passing `DeployApp=false`.
3. **No drift on the function code.** Every deploy passes a new `ImageUri` to the SAM stack instead of calling `lambda update-function-code`, so CloudFormation always owns the code and the configuration.
4. **Immutable image tags.** The tag is `<BUILD_NUMBER>-<git sha>` and `latest` is rejected.
5. **Termination protection** is turned on for both stacks after each deploy.
6. **Optional parameters are only sent when set.** `SECRET_NAME`, extra hosts, OAC, memory and timeout keep their current stack values if the variable is not defined, so nothing is reset by accident.
7. **Least-privilege Lambda role.** It replaces `AWSLambdaBasicExecutionRole`. The role only gets `CreateLogStream`/`PutLogEvents` on its own log group, has an `aws:SourceAccount` condition on the trust policy, and gets `GetSecretValue` only when a secret is set (scoped to `secret:<name>-??????`).
8. **Function URL permissions in the current format:** `lambda:InvokeFunctionUrl` plus `lambda:InvokeFunction` with `InvokedViaFunctionUrl: true`.
9. **Optional CloudFront OAC**, off by default (§6).
10. **`Project` / `Environment` tags** set explicitly on every taggable resource (§5).
11. **Branch protection** in Jenkins and in the script: `prod` deploys only from `main`, `staging` only from `staging`.

## 5. AWS resources and tags

Tags are written explicitly in each resource, without relying on propagation. Default values: `Project=onecgiar-qa-frontend` (parameter `ProjectName`), `Environment=dev|staging|prod`, plus `Name` and `ManagedBy=CloudFormation`. The deploy script also applies `Project`, `Environment` and `ManagedBy` to both stacks.

| Stack | Logical ID | Type | Tags |
|-|-|-|-|
| ECR | `EcrRepository` | `AWS::ECR::Repository` | ✅ explicit |
| App | `LambdaLogGroup` | `AWS::Logs::LogGroup` | ✅ explicit |
| App | `LambdaExecutionRole` | `AWS::IAM::Role` | ✅ explicit |
| App | `AppFunction` | `AWS::Serverless::Function` → `AWS::Lambda::Function` | ✅ explicit (SAM map; SAM adds `lambda:createdBy`) |
| App | `CloudFrontDistribution` | `AWS::CloudFront::Distribution` | ✅ explicit |
| App | `FunctionUrl` | `AWS::Lambda::Url` | ❌ not supported by AWS |
| App | `PublicFunctionUrlPermission`, `PublicInvokeViaUrlPermission` (public mode) | `AWS::Lambda::Permission` | ❌ not supported |
| App | `CloudFrontFunctionUrlPermission`, `CloudFrontInvokeViaUrlPermission` (OAC mode) | `AWS::Lambda::Permission` | ❌ not supported |
| App | `OriginAccessControl` (OAC mode) | `AWS::CloudFront::OriginAccessControl` | ❌ not supported |

**Why native resources for the Function URL:** SAM's `FunctionUrlConfig` needs a literal `AuthType`, but the OAC switch needs it to come from a condition. For the same reason the role is explicit rather than SAM-generated. Nothing is duplicated: SAM only generates the `AWS::Lambda::Function`. There are no circular references either: the distribution depends on the URL, and the OAC permissions depend on the distribution.

## 6. CloudFront OAC (optional, off)

- **How to turn it on:** set `ENABLE_ORIGIN_ACCESS_CONTROL=true` when running `deploy-ecr.sh`, which passes `EnableOriginAccessControl=true` to the stack.
- **What changes:**
  - The Function URL switches to `AuthType AWS_IAM`.
  - An OAC with `lambda` origin type, `sigv4` and `always` signing is attached to the origin.
  - The public permissions are replaced by permissions for `cloudfront.amazonaws.com`, limited to this distribution's ARN.
  - Calling the Function URL directly then returns 403.
- **IAM needed by the deploy principal:** `cloudfront:CreateOriginAccessControl`, `GetOriginAccessControl`, `UpdateOriginAccessControl`, `DeleteOriginAccessControl` and `lambda:AddPermission`/`RemovePermission`, on top of the existing CloudFront and Lambda permissions.
- **Requests with a body:** with OAC, CloudFront signs requests but does not hash the body. POST/PUT/PATCH requests to the Lambda must include an `x-amz-content-sha256` header (the SHA-256 of the body) from the client, or the Lambda rejects them. Today the frontend only serves GET/HEAD; its API calls go to the separate backend.
- **During the switch:** changing the setting updates the URL and permissions in place, so expect a few seconds of 403 while the update runs.

## 7. Jenkinsfile (local, not versioned)

- **Location:** `client/Jenkinsfile`.
- **Excluded from git:** `git check-ignore` → `client/.gitignore:47:/Jenkinsfile`. `git ls-files` shows it is not tracked, and `git status` does not list it.
- **Structure (IBD):**
  - `@Library('db-operations@dev') _`, `agent any`, `tools { nodejs 'NodeJS-22' }`.
  - Explicit environment block: repo, branch, environment, `client/` directory, AWS, Slack.
  - **Start:** branch guard (`prod` only from `main`, `staging` only from `staging`) and a Slack "started" message.
  - **Cloning Git:** checkout, `IMAGE_TAG = <BUILD_NUMBER>-<sha>`, and `getLastCommitInfo()` logged.
  - **Startup:** `npm ci` in `client/`.
  - **Test:** `npm test -- --watch=false`. The `test` script runs `ng test`; there is no `test:ci` script.
  - **Build:** `npm run build`.
  - **Deploy:** `withCredentials` (AWS) → `bash scripts/deploy-ecr.sh`.
  - **post:** Slack messages on success and failure. Channel `#notifications-platform`, credential `slack-token`.
- **Configure Lambda Environment** is **omitted on purpose.** Every runtime variable is declared in `template.yaml`; setting them with `update-function-configuration` would create drift and be overwritten on the next deploy.
- **Values to adjust per job:**
  - The `BRANCH_NAME` / `DEPLOY_ENV` pair.
  - `GIT_CREDENTIALS` and `AWS_CREDENTIALS` (credential IDs; placeholders in the file).
  - The Node tool name `NodeJS-22`.
  - `getLastCommitInfo()` is called with no arguments and its result is used as text. Adjust if the `db-operations` library signature is different.

## 8. Bootstrap and deployment

`client/scripts/deploy-ecr.sh` (run by Jenkins, never run locally). The same flow covers the first deployment and every later one:

1. Validate `ENVIRONMENT` and the branch guard, and reject the `latest` tag.
2. `cloudformation deploy` of `ecr.yaml` (`--no-fail-on-empty-changeset`) and enable termination protection.
3. `docker build` and push to `<repo>:<BUILD_NUMBER>-<sha>`.
4. `cloudformation deploy` of `template.yaml` (`CAPABILITY_NAMED_IAM CAPABILITY_AUTO_EXPAND`; CloudFormation applies the SAM transform itself, so the agent doesn't need SAM CLI) and enable termination protection.
5. CloudFront invalidation `/*` and print the stack outputs.

**Safety properties:**
- **Retained on stack delete:** the ECR repository.
- **Never deleted by a later deploy:** the application stack has no switch that removes resources.
- **Rollback:** a failed update rolls back automatically.

**Least-privilege policy for the deploy principal:** see the checklist in §11.

## 9. Validations

| Check | Result |
|-|-|
| `npm ci`, `ng test` (6 files / 47 tests), `ng build` production | ✅ First pass. The second pass did not touch application code, so they were not rerun. Bundle budget warning was already there. |
| SSR server from `dist/` only, with no `node_modules` and the Dockerfile env vars | ✅ First pass. 200 on `/login` (SSG), `/` and assets; 302 on protected routes; 400 for a foreign host; 400 everywhere without `NG_ALLOWED_HOSTS`. |
| `sam validate --lint` on `ecr.yaml` and `template.yaml` (offline: no credentials, telemetry off) | ✅ Both valid. The linter rejected a misspelled property in a test copy, so `InvokedViaFunctionUrl` is a property it knows. |
| `bash -n scripts/deploy-ecr.sh` | ✅ |
| Consistency between templates and script | ✅ The `EcrRepositoryUri` and `CloudFrontDistributionId` outputs used by the script exist. The image URI the script builds matches the `ImageUri` pattern. Parameter names match. |
| Jenkinsfile kept out of git | ✅ (§7) |
| Colleague's branch unchanged | ✅ `jp-design/mockup-completo` = `origin` = `ab04612` |

**Still to be validated manually (needs Docker, AWS or Jenkins):**
- `docker build` / `docker run` of the image.
- First deployment of both stacks.
- OAC mode.
- Function URL and CloudFront end-to-end.
- Jenkinsfile syntax: no Groovy or Jenkins linter is available locally.
- `getLastCommitInfo` signature, credential IDs and Node tool name.

## 10. AWS incident (2026-10-09)

- **What happened:** while checking `deploy-ecr.sh`, Claude ran it with fake `aws`/`docker` commands. The fakes were skipped (the `C:` in the path broke `PATH` in Git Bash), so the **real AWS CLI** ran with the local credentials.
- **What was created**, in us-east-1, before the Docker step failed:
  - Stack `onecgiar-qa-frontend-dev-ecr` → ECR repo `onecgiar-qa-frontend-dev`
  - Stack `onecgiar-qa-frontend-prod-ecr` → ECR repo `onecgiar-qa-frontend-prod`
  - Both stacks have termination protection on, both repos are empty, and both are tagged `Project=onecgiar-qa-frontend`.
- **What was not created:** no image pushed, no app stack, Lambda, CloudFront or IAM role.
- **Status:** the repo owner will review and decide on cleanup. Claude made no further AWS calls after the incident report. Deploy scripts are no longer run locally.
- **Note for the first real deploy:** the dev/prod ECR stacks and repos already exist. `deploy-ecr.sh` would reuse them unchanged. Delete them first if you want a clean start; they have termination protection, and the repos are kept when the stack is deleted.

## 11. Pending on the owner's side

- [ ] Decide on the incident resources (§10).
- [ ] Jenkins:
  - One job per branch (`dev`, `staging`, `main`) with the content of `client/Jenkinsfile`.
  - Set `BRANCH_NAME`/`DEPLOY_ENV` and the credential IDs (Git, AWS, `slack-token`).
  - Node 22 tool.
  - Agent with Docker, AWS CLI v2 and bash.
- [ ] Deploy principal IAM permissions:
  - **CloudFormation:** deploy/describe/changeset and `UpdateTerminationProtection`.
  - **ECR:** auth token, push, and repository create/policy (Lambda adds the pull policy).
  - **IAM:** create/update/tag role `*-lambda-role` and `iam:PassRole` limited to `lambda.amazonaws.com`.
  - **Lambda:** create/update/tag function, Function URL, Add/RemovePermission.
  - **Logs:** create/tag/retention.
  - **CloudFront:** distribution, invalidation, and OAC if used.
- [ ] Secrets Manager secret: only when the frontend needs runtime config (`SECRET_NAME`; name only, not an ARN).
- [ ] Manual validations listed in §9.

## 12. Known limitations

- Only `/login` is server-generated. The other routes render client-side, as before this work.
- SSR sees the Function URL host, not the public domain.
- CloudFront caches nothing; this follows the reference.
- The Function URL is public unless OAC is turned on.
- The repo's `CLAUDE.md` puts the session's git email in protected mode. Only new files were added, plus 3 lines in `client/.gitignore`. The branch comes from `jp-design/mockup-completo` as requested, not from `staging`.
