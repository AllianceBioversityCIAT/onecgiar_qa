# AI suggestions on AI-input fields — Design

## 1. Modules

```
server/src/ai-suggestions/
  contract/            copy of the worker contract (schemas, examples, production.json) + SOURCE.md (repo, branch, commit)
  ai-config.ts         loads production.json once; eligibleFields(membership, effectiveConfig) (FR-1)
  ai-jobs.port.ts      AiJobsPublisher { send(jobs): {sent, failed} }  — SQS adapter / no-op adapter
  sqs-ai-jobs.ts       SendMessageBatch (10), 3 tries
  ai-store.ts          ElectroDB aiSuggestion + aiRun; listForSnapshot, setExpected
  ai-enqueue.service.ts  called by LoadRunner after recordLot; re-enqueue (FR-3)
  ai-suggestions.controller.ts / .service.ts   GET + POST events
  ai-usage.store.ts    Drizzle ai_suggestion_usage
server/src/database/dynamodb/entities/ai-suggestion.entity.ts, ai-run.entity.ts
server/drizzle/0010_ai_suggestion_usage.sql (+ rollback)
```

`LoadRunner` gets one new optional dependency, `AI_ENQUEUE` (port). The hook runs **after** `recordLot` returns `recorded`, on `recorded.insertedCodes` plus the re-submitted codes, so a job never points to a snapshot without a membership (DD-4 of ingestion). Errors are caught inside the service: the runner never sees them.

## 2. DynamoDB entities (same pattern as `resultSnapshot`)

| Entity | Model | pk | sk |
|---|---|---|---|
| `aiSuggestion` | `{entity:'aiSuggestion', version:'1', service:'qa'}` | `RESULT#${resultCode}` | `AI#${snapKey}#${fieldKey}#${promptVersion}` |
| `aiRun` | `{entity:'aiRun', version:'1', service:'qa'}` | `AIRUN#${runId}` | `RUN` |

`field: 'pk'/'sk'`, `casing: 'none'`, `template` as above. The API only reads `aiSuggestion`; it writes `aiRun.expected` with a raw `UpdateItem` (`SET expected = :n, createdAt = if_not_exists(...), __edb_e__ = if_not_exists(...), __edb_v__ = if_not_exists(...), runId = if_not_exists(...)`) so it composes with the worker's `ADD` counters (C-6).

## 3. Migration 0010 `ai_suggestion_usage`

Keyed on the **membership and step** (`timeline_result_id`, `step_position`), not on `result_assessments`: a suggestion is shown before the reviewer writes anything, and a read never creates the assessment (step-1-assessment DD-3). FR-11 reaches the assessment through the same pair.

| Column | Type | Note |
|---|---|---|
| id | bigint pk | |
| suggestion_id | char(32) | worker's id |
| timeline_result_id | bigint FK `timeline_results` | the membership, not a person |
| step_position | tinyint | the reviewer's step |
| role_code | varchar(32) | ASSESSOR / LEAD_ASSESSOR |
| field_key | varchar(200) | |
| prompt_version | varchar(32) | |
| ai_signal | enum green/amber/red | copied from the suggestion (`signal` is a MySQL reserved word) |
| action | enum shown/copied/comment_saved/validated_above_ai | |
| dedupe_action | varchar(32) generated stored | `IF(action = 'comment_saved', NULL, action)` |
| comment_id | bigint null, FK `assessment_comments`, unique | `comment_saved` |
| edited | boolean null | `comment_saved` (never the text) |
| ai_level | tinyint null | `shown` (from the item's `suggestedValue`) and `validated_above_ai` |
| reported_level | tinyint null | `shown` (from the item's `reportedValue`) |
| validated_level | tinyint null | `validated_above_ai` |
| reason | varchar(200) null | `validated_above_ai` |
| created_at | datetime(3) | |

- Unique `uq_ai_usage_once (suggestion_id, timeline_result_id, step_position, dedupe_action)`: `shown`, `copied`, `validated_above_ai` once each; `comment_saved` once per comment (`uq_ai_usage_comment`). A repeat is a 204 no-op.
- CHECK `chk_ai_usage_above`: a `validated_above_ai` row has a reason and `validated_level >= ai_level + 2`.
- **No user column** (NFR-3); the schema test fails if one appears.
- Manual down script: `drizzle/rollback/0010_ai_suggestion_usage.down.sql`.

## 3b. Routes (as built)

| Route | Who | Answer |
|---|---|---|
| `GET /timelines/:timelineId/results/:resultCode/ai-suggestions` | `@ReadAccess`; audience by `aiAudienceOf` | `AiSuggestionView[]` (worker's view schema); 403 `AI_SUGGESTIONS_FORBIDDEN` (PPU); 404 as the assessment view; 503 on a DynamoDB failure |
| `POST …/ai-suggestions/:suggestionId/events` | ASSESSOR / LEAD_ASSESSOR | 204; 400 `AI_EVENT_INVALID`; 403 `ASSESSMENT_READ_ONLY` (TPB, ADMIN) or `AI_SUGGESTIONS_FORBIDDEN` (PPU); 404 `AI_SUGGESTION_NOT_FOUND` (unknown, unavailable or not eligible) |
| `GET /ai-suggestions/analysis/missing-reasons` | ADMIN | `{ basis: 'shown', fields: [{ fieldKey, promptVersion, withReason, withoutReason }] }` |

**Role rows today.** Only the ASSESSOR row of the role-step table is enabled, so a TPB, LEAD_ASSESSOR or PPU gets the assessment 404 before the audience is decided. Their branches (TPB read-only with the mark, LEAD as reviewer, PPU 403) are unit-tested and take effect when their rows are enabled.

## 4. Decisions

| # | Decision | Why |
|---|---|---|
| DD-1 | `runId = load-<loadId>` | Deterministic: a lot retry and FR-3 address the same run |
| DD-2 | Enqueue after `recordLot`, not after `putSnapshots` | Orphan snapshots of a failed lot must not cost Bedrock calls |
| DD-3 | No outbox table for jobs | Jobs are recomputable from memberships; the worker is idempotent. A failed send is a log line + FR-3 |
| DD-4 | Publisher off when `AI_JOBS_QUEUE_URL` is unset, **never silently**: startup warning + 409 `AI_JOBS_DISABLED` on the admin routes (FR-3b) | Merge and run locally / in envs without the permission |
| DD-5 | `production.json` copied, not fetched | Version and fields move with a deploy, checked by the contract test |
| DD-6 | Chip = own component + own store; T-19's mapper gets one input (`aiByField`) | No duplication with T-19; one small PR on top |
| DD-7 | `AiVm` widened to `{status, signal, label, explanation, quote, reason}` | The mockup's `mismatch: boolean` cannot express amber or unavailable. Design review with Juanpa/Yeck at T-12 |

## 5. Contract test (`server/test/ai-contract.spec.ts`)

1. `contract/SOURCE.md` names the worker commit; each schema/example file hash matches a manifest in `contract/` (drift = red, refreshed by a script `npm run ai-contract:sync <path>`).
2. Every `contract/examples/*.json` is put into an in-memory DynamoDB fake and read back through the ElectroDB `aiSuggestion` query (`begins_with AI#<snapKey>#`) → same attributes.
3. GET responses in the e2e suites are validated with Ajv (2020-12) against `ai-suggestion-view.schema.json`; job bodies against `ai-job-message.schema.json`; event bodies against `ai-suggestion-event.schema.json`.

## 6. Client

- `core/api/ai-suggestions-api.ts` (on T-17's transport), `review/ai/ai-suggestions-store.ts`, `review/ai/ai-chip.ts` (spartan badge + Tailwind tokens; red label "Review").
- Wiring: `review-view` passes `aiByField()` to the mapper in place of `null`; `review-ai-note` renders `AiVm`.
- Events: `shown` when the chip enters the viewport once; `copied` on "Copy to comment"; `comment_saved` after the comment save succeeds and the box came from a copy; `validated_above_ai` from the reason dialog (spartan dialog) before validate.
- Every AI request failure degrades to "Suggestion not available"; events are fire-and-forget (never block the reviewer).

### 6.1 Built (17-nov) — files

| File | What |
|---|---|
| `core/api/ai-suggestions.models.ts` | View and event types mirroring the worker schemas; `AI_LEVEL_FIELDS` |
| `core/api/ai-suggestions-api.ts` | `list`, `sendEvent` (silent errors; events `NO_QUEUE`, never in Unsent) |
| `pages/workspace/review/ai/ai-chip.vm.ts` | Pure view → `AiChipVm`: green "Looks consistent", amber "Check", red "Review" (never "Incorrect"); IRL/IUL headline + verified quote; reason text per unavailable code; TPB mark |
| `pages/workspace/review/ai/ai-suggestions-store.ts` | Per-result store (`load`, `byField`, `chipFor`, `markShown`, `copied`, `commentSaved`, `validatedAbove`); fire-and-forget events; a failed read → "Suggestion not available" |
| `pages/workspace/review/ai/ai-chip.ts` | The chip; `shown` once visible (IntersectionObserver, emitted at once where unavailable); "Copy to comment" hidden when read-only |
| `pages/workspace/review/ai/ai-reason.ts`, `ai-reason-dialog.ts` | `needsReason`, `reasonError`, `validateWithReason` (event, then validate) and the one-line dialog |
| `pages/workspace/ai-preview/**` | Plan B (below) |

### 6.2 Plan B variant

Instead of feeding the mockup Review page (T-19's files, `review-view.ts`), plan B is a **separate read-only page** `ai-preview/:timelineId/:resultCode` that lists a result's chips from the real GET. It sends no usage events. Its route is guarded by `aiPreviewMatch` (before `permissionMatch`): it matches only when the build flag `AI_PREVIEW` is on and the environment is not named `production`. `ai-preview.flag.ts` holds the production value, typed `false` (turning it on is `TS2322` and the production build fails); `angular.json` swaps in `ai-preview.flag.on.ts` for the `development` and `test` configurations. It is not an environment field because CI and the deploy overwrite the environment files from Secrets Manager. Deleted with plan A (tasks T-6, step 5).
