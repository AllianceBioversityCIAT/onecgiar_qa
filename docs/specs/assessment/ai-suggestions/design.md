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

| Column | Type | Note |
|---|---|---|
| id | bigint pk | |
| suggestion_id | char(32) | worker's id |
| assessment_id | bigint FK `result_assessments` | the step-1 assessment, not a person |
| role_code | varchar(32) | ASSESSOR / LEAD_ASSESSOR |
| field_key | varchar(128) | |
| prompt_version | varchar(32) | |
| signal | enum green/amber/red | copied from the suggestion |
| action | enum shown/copied/comment_saved/validated_above_ai | |
| comment_id | bigint null | `comment_saved` |
| edited | boolean null | `comment_saved` |
| ai_level | tinyint null | `shown` (from the item's `suggestedValue`) and `validated_above_ai` |
| reported_level | tinyint null | `shown` (from the item's `reportedValue`) |
| validated_level | tinyint null | `validated_above_ai` |
| reason | varchar(200) null | `validated_above_ai` |
| created_at | datetime(3) | |

Unique `(suggestion_id, assessment_id, action)` for `shown`, `copied`, `validated_above_ai` (generated column `dedupe_key`, null for `comment_saved`). **No user id column** (NFR-3).

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
