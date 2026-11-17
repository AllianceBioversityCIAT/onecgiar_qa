# AI suggestions on AI-input fields — Execution log

## Verification summary (2026-11-17)

| Check | Result |
|---|---|
| Server `pnpm lint` | 0 warnings |
| Server `pnpm build` | green |
| Server unit (`pnpm test`) | 3803 passed, 6 skipped |
| Server e2e (`pnpm test:e2e`) | 1179 passed |
| Client `ng build` (production) | green; initial bundle 620.23 kB vs 500 kB budget is a pre-existing warning (619.93 kB at `03cae5a`, before the client work) |
| Client `ng build --configuration development` | green |
| Client `ng test` | 56 files, 489 passed |
| `qa-dev-cicd` on `dev` (`cbe6453`) | all jobs green, images published, Jenkins deploy triggered |
| TEST API after deploy | `GET /health` ok; the 4 AI routes are in `/docs/openapi.json` and answer 401 without a session |

## Tasks

| Task | Commit | Tests added | Falsifiers (observed red, then reverted) |
|---|---|---|---|
| T-2 contract, entities | `88facb0` | `ai-contract.spec.ts` (7) | default casing on the sk → the example query returns nothing (2 red); one byte changed in a copied schema → manifest test red |
| T-3 eligible fields | `88facb0` | `ai-config.spec.ts` (6) | — (table test) |
| T-4 enqueue + routes | `655f7cf` | publisher 5, enqueue service 11, `ingestion-ai-jobs.e2e-spec.ts` 6 | publisher error propagated → "a failing queue never fails the load" red; ADD instead of SET → `expected [4, 6, 8] to deeply equal [4, 6, 6]` |
| T-5 GET, T-8 events + 0010, FR-11 | `03cae5a` | rules 33, usage store 3, `ai-suggestions.e2e-spec.ts` 29, schema +7, OpenAPI +1 | diff ≥ 1 accepted → "refuses a difference of exactly 1" red; eligible filter removed → "AI input but not in production" red; ADMIN given the mark → "ADMIN … without the copied mark" red |
| T-6, T-9 client chip, store, copy, events | `ee22a19` | 49 across the AI specs | red mapped to "Incorrect" → 3 red |
| T-10 reason | `3168433` | in `ai-reason.spec.ts` | — |
| Plan B page | `c448ae4` | `ai-preview.spec.ts` | `aiPreview: true` in `environment.ts` → PROD build `TS2322: Type 'true' is not assignable to type 'false'` |

## Decisions made during execution

- Usage rows are keyed by membership + step, not assessment id: `shown` comes before any write and a read never creates the assessment (design § 3b).
- Load AI routes live under `timelines/:timelineId/loads/:loadId/ai-jobs`, like the other load routes.
- Plan B is a separate dev/test-only route (`/ai-preview/:timelineId/:resultCode`) instead of editing the mockup Review page, so T-19's files are untouched.
- `ai_signal` instead of `signal` (MySQL reserved word).

## Related fix (not part of this spec)

The assessment field-description change (`2cc8384`) put Reporting's help text, which contains example e-mail addresses, into the view, and the FR-11 no-`@` e2e check failed on `dev` (the pipeline did not deploy). Fixed by leaving `description` out of that check: `cb6cf4d` merged into `dev` (`cbe6453`) and cherry-picked into `staging-center` (`98825ce`).

## Infra checks (read-only, 2026-11-17)

| Item | Result |
|---|---|
| `qa-ai-worker-test` | Active, `TABLE_NAME = cgiar-qa-test` |
| `qa-ai-suggestions-test` / DLQ | exist, 0 messages, redrive `maxReceiveCount` 3 |
| `cgiar-qa-test` | ACTIVE |
| QA API TEST → `cgiar-qa-test` | not visible from this account (the API is neither a Lambda nor an ECS task here); confirm on the host |
| `sqs:SendMessage` + `AI_JOBS_QUEUE_URL` for the TEST API | requested from Cris; until then the sync logs `ai_enqueue outcome: disabled` and the admin routes answer 409 `AI_JOBS_DISABLED` |
| PROD: `qa-ai-worker-prod`, `cgiar-qa-prod`, `qa-ai-suggestions-prod` | **none found** in the account checked; T-11 blocked until the worker's PROD stack and table exist (or the right account is named) |

## Still open

- **T-7 (HITL, gate M1):** after Cris: one real sync of a small timeline as ADMIN → `GET …/loads/:loadId/ai-jobs` until `complete` → `GET …/ai-suggestions` as an assessor; DLQ empty.
- **Wiring:** T-19 → chip into Review (steps in `tasks.md` T-6); T-20 → copy / events / reason (T-9, T-10). Cut-off for Plan A: Thu 19-nov.
- **FR-5b:** Lead / TPB / PPU end-to-end when their role-step rows are enabled.
- **AI error codes** (`AI_SUGGESTIONS_FORBIDDEN`, `AI_SUGGESTION_NOT_FOUND`, `AI_EVENT_INVALID`, `AI_JOBS_DISABLED`) into the front contract when the Review wiring lands.
