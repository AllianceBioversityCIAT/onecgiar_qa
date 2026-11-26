# src/assessment — Agent Guide

Step-1 assessment: the worklist an assessor opens, the assessment view of one result, field validations, comments, the end of an assessment, quick comments, and the release outbox that tells Reporting a result left QA. **Spec:** `docs/specs/assessment/step-1-assessment/` (`design.md`, DD-1…DD-16; `front-contract.md` is what the front may rely on). Root and `server/AGENTS.md` rules apply.

## Model in one line

An assessor (or an ADMIN, read only unless it acts as a role with `X-Acting-Role`) lists the memberships of a timeline (`GET /timelines/:id/worklist`), opens one, greens or comments Assessed fields, and finishes: `quality_assessed` when no core field is grey, `returned` when every grey core field has a comment. The end queues one `assessment_releases` row in the same transaction; `ReleaseService` sends it to Reporting after the commit and, on the answer, ends the membership.

## Files

| Path | Role |
|---|---|
| `assessment.module.ts` | Wires the module (see *Bindings*) |
| `worklist.controller.ts`, `worklist.service.ts`, `worklist.store.ts`, `worklist-cursor.ts` | 3 reads (`/worklist/timelines`, `/timelines/:id/worklist`, `…/worklist/options`); a fixed number of statements per read (timelines 2, page 4), none per row; the opaque cursor is valid only with the same `sort` and `dir` |
| `assessment.controller.ts`, `assessment.service.ts` | 5 routes (view, validations, comments `@Idempotent()`, finish, withdraw). The service owns scope, the 404 that tells nothing, and the removal of Hidden fields; nothing is filtered in the controller |
| `assessment-view.ts`, `comment-value-copy.ts` | Pure: the view over catalog + snapshot + configuration; the 64 KiB value copy (labels dropped first, then the value cut) |
| `assessment.store.ts`, `assessment.unit-of-work.ts` | Read and write ports with their Drizzle adapters; one READ COMMITTED transaction per write |
| `assessment-rules.ts`, `comment-transitions.ts`, `role-steps.ts`, `scope.ts`, `qa-status.ts` | Pure: the end rule; the comment state table (`open`, `withdrawn`, the author's clarification answer and every program response are `reachable`, P2-3911); the role-step table (ASSESSOR is the only enabled writer); scope and the write decision; the status table, read by `statusOf` (TS) and `statusSqlCase` (SQL) so the two cannot drift |
| `quick-comments.controller.ts`, `quick-comments.service.ts` | `GET` and `POST /quick-comments` |
| `release.service.ts`, `release.store.ts`, `releases.controller.ts` | The release outbox and its two admin routes |
| `release-sweeper.ts` | `ReleaseSweeper`: the timer that dispatches the outbox every `RELEASE_SWEEP_INTERVAL_MS` (P2-3910 bug) |
| `title-backfill.ts` | Bootstrap hook (not awaited): fills `timeline_results.title` for memberships written before the column existed |
| `assessment-log.ts` | The one decision log line of a write (*Logging*) |
| `assessment.errors.ts`, `dto/`, `models/` | The 14 `ASSESSMENT_*` codes (all in the step-1 front contract § 9; the round-2 contract § 7 adds the 6 round-2 ones), pipe shapes, OpenAPI models |

## AI suggestions (spec `assessment/ai-suggestions`)

- `ai-suggestions.controller.ts`, `ai-suggestions.service.ts`: `GET …/ai-suggestions`, `POST …/ai-suggestions/:suggestionId/events`, `GET /ai-suggestions/analysis/missing-reasons` (ADMIN). Scope and 404 come from `AssessmentService.resolveForAi` (the same resolver as `open`); the service never writes an assessment: the AI never validates or comments.
- `ai-suggestions-rules.ts` (pure): `aiAudienceOf` (ASSESSOR/LEAD → reviewer; TPB → read-only with the copied/edited mark; ADMIN → read-only **without** the mark; PPU → 403), `toSuggestionViews` (exactly the worker's `ai-suggestion-view.schema.json`), `checkAboveAi`, `isEdited`.
- Items are read from DynamoDB (`AI_SUGGESTION_STORE`, one Query, production prompt version only); a read failure is 503.
- `ai-usage.store.ts` → `ai_suggestion_usage` (migration 0010), keyed on membership + step. **It measures the AI, not the reviewers:** no user column, no comment text, no route returns usage per reviewer. Do not add one.
- New codes: `AI_SUGGESTIONS_FORBIDDEN`, `AI_SUGGESTION_NOT_FOUND`, `AI_EVENT_INVALID` (in `ai-suggestions.errors.ts`, kept out of `assessment.errors.ts` so the `ASSESSMENT_*` contract check is unchanged).

## Science Program view (P2-3911, `sp-view/`)

Science Program users (from Reporting, in an iframe) read the QA comments of their program's results and respond to them; the assessor answers a clarification. Contract with Reporting: `docs/sp-view/reporting-integration.md`. Migration `0011_sp_view` (down script in `drizzle/rollback/`).

| Path | Role |
|---|---|
| `sp-access.controller.ts`, `sp-access.service.ts`, `sp-access.store.ts`, `sp-api-key.guard.ts`, `sp-tokens.ts` | `POST /sp-access/codes` (Reporting back only, `x-api-key` = `SP_ACCESS_API_KEY`; 201 `{ code, expiresAt }`, single use, 60 s) and `POST /sp-access/session` (`{ code }` → 200 `{ accessToken, expiresAt, user: { name }, program, isReportingAdmin }`, 8 h; 10/min per IP). Both `@Public()` (FR-10 list) |
| `sp-session.decorator.ts`, `sp-session.guard.ts` | `@SpSession()` = `SP_SESSION_KEY` metadata (`auth/decorators/sp-session.metadata.ts`, so both global Cognito guards skip the route) + `SpSessionGuard` + the `sp-session` OpenAPI scheme. Never set the metadata alone: `auth-hardening.e2e-spec.ts` sweeps every SP route for the guard and a 401 |
| `sp-view.controller.ts`, `sp-view.service.ts`, `sp-view.store.ts`, `sp-thread.ts` | `/sp/me`, `/sp/timelines`, `/sp/timelines/:id/results`, `/sp/timelines/:id/results/:code` (the assessment view via `AssessmentService.viewInputsFor`, comments in the SP shape), `PUT /sp/comments/:id/response` |
| `sp-response.service.ts`, `sp-response.unit-of-work.ts` | The program response and the assessor's clarification answer (one transaction each), the assessor's `GET /timelines/:id/results/:code/sp-responses` |
| `sp-assessor.controller.ts` | Cognito routes: `POST /assessment-comments/:id/clarification-answer`, `GET …/sp-responses` |
| `sp-csv.ts` | `GET /sp/timelines/:id/results/:code/comments.csv`: `@Res()` so the file skips the envelope (errors keep it); cells quoted and formula starts neutralized |
| `sp-log.ts`, `sp-view.errors.ts` | `event:'sp_access'` / `event:'sp_response'` lines; the `SP_*` and `CLARIFICATION_NOT_PENDING` codes |

Rules:

- **No assessor identity to the program.** No SP statement selects an author id, nickname, name or email; SP comments carry the responder's name only (the assessor side adds the email, AC12). `test/sp-view.e2e-spec.ts` plants nicknames and names and checks every `/sp` answer.
- **Step-2 window.** A comment is visible to the program when `visible_to_program_at` is set, it is not withdrawn and not deleted and the `programs` step has started (in progress or closed); before that, none. Responses and clarification answers only while that step is `in_progress` at the clock's Rome minute (re-judged under the timeline share lock).
- **Scope = 404.** A non-admin session sees only its program; an admin session names `programId` (400 when missing). Another program, another timeline, a hidden or missing comment: the same 404 `SP_NOT_FOUND` body.
- **A response changes the comment only**: state (conditional `UPDATE … WHERE state = ?`), an `sp_comment_responses` row, a `comment_events` row with `actor_id` NULL, role `PROGRAM` and `sp_response_id`. Never a validation, the assessment status, a release or the membership. Lock order as above.
- **Secrets.** Codes and session tokens are 32 random bytes, stored only as SHA-256 hex; the API key is compared in constant time over SHA-256. QA signs nothing.
- **Logs:** ids, fixed words and error codes only: never an email, a name, a code, a token, the key or a body.

## Round 2: the Lead Assessor (P2-3912, spec `escalation/round-2`)

A Lead Assessor reviews a re-submitted (round-2) membership in step 3. Contract: `docs/specs/escalation/round-2/front-contract.md`. Migration `0013_round_two` (down script in `drizzle/rollback/`). The code stays in this folder (DD-1).

| Piece | Rule |
|---|---|
| Lead row | `ROLE_STEPS` `LEAD_ASSESSOR`: enabled, `round: 2`, step `lead_assessors`. The TPB row is enabled by P2-3916 and the PPU row by P2-3917 (next sections) |
| Current step (DD-3) | A round-1 membership reads the `assessors` assessment; a round-2 one reads its latest assessment among steps 3 to 5, else step 3. `qa-status.ts`, `statusSqlCase` and the worklist join use that one rule |
| Core only | Only Assessed **core** fields take a validation, comment or decision (`isActionable`); else 409 `ASSESSMENT_FIELD_NOT_CORE`. Check all covers core fields and is refused whole while one is escalated |
| Carried green (DD-4) | Computed, never copied: stored row, else round-1 green with no round-1 comment and not in `changed_fields` (`effectiveGreen`) |
| Decisions | `comment_decisions`, one row per comment and role, changed or cleared only while the Lead's assessment is `pending`. `agree_program` is always stored and greens the field in the same transaction, unless another live round-1 comment on it is still undecided; `escalate` refuses its validation. Validating green a core field with a live decidable round-1 comment and no live decision is 409 `ASSESSMENT_CORE_COMMENT_UNDECIDED` with sorted `fields`, whole request refused, nothing written (`undecidedCommentFields`; escalated precedence first; un-validation never refused). States are written **at the end** (DD-7): `agree_program` to `lead_sided_program`, `escalate` to `escalated` |
| End mapping (DD-5) | `endOnFinish` / `endAfterValidation` reused through `round-two-rules.ts`: all green gives `quality_assessed` plus one `qaed` release; grey core fields all escalated give `escalated` (Pending for TPB review) and **no release row**; a grey one with no escalate is `ASSESSMENT_CORE_UNDECIDED`. Round 2 never ends `returned` |
| Own comment in the view (T-16) | In round 2, for the Lead, the field's `comments[]` items the caller wrote in round 2 carry `decision` (object or `null`), `decidable`, `choices` (`annotateForRound`). `[]` once withdrawn or after the review ends (`RoundViewInput.ended`: the assessment is not `pending`, or the view is not writable), whatever the comment state. The Lead's `thread[]` items follow the same `ended` rule (T-17: `decidable: false`, `choices: []`, `decision` kept), so the front gates on `decidable` alone. A `thread[]` item also drops `agree_program` from `choices` while another live comment on the field (a thread item or the Lead's own, from `ownDecisions`) carries an `escalate`, mirroring `ASSESSMENT_FIELD_ESCALATED`; its own escalate does not count. Absent in round 1 and for every other role or author. One extra statement (`findDecisions`, read store, Lead only, in the existing `Promise.all`) once the round-2 assessment row exists |
| No visibility (DD-8) | Round 2 never calls `markCommentsVisible`. The SP view stays round-1 only |
| SP mapping (DD-11) | A review state (`escalated`, `lead_sided_program`) reads to the program as the state its latest response implies (`open` with no response, or a clarification already answered). One mapping in the SP read; the SP write still judges the stored state |
| Delete (DD-9) | `POST /assessment-comments/:id/delete`: soft delete (`deleted_at`, `deleted_by`) of another reviewer's comment in step 3; drops the Lead's decision on it; can end the review. Every reader of comments excludes deleted ones |
| Withdraw | Opens in step 3 for a round-2 comment; after the end an escalated own comment is `ASSESSMENT_COMMENT_NOT_OPEN` |
| Logging | New `loggedWrite` actions `decide`, `decision_clear`, `delete` (ids only); audit actions `decision_set`, `decision_clear`, `comment_delete`, `end_escalated` |
| Tests | `test/assessment-round-two-*.e2e-spec.ts` over the shared fixture `test/support/round-two-fixture.ts` (real `runRealLoad`, never hand-built keys); `assessment-round-two-flow.e2e-spec.ts` is the whole path |

## Round 2: the TPB (P2-3916, spec `escalation/round-2-tpb`)

In step 4 the Third-Party Broker settles each comment the Lead escalated. Contract: `docs/specs/escalation/round-2-tpb/front-contract.md`. **No migration**: `0013` already declared every value.

| Piece | Rule |
|---|---|
| TPB row | `ROLE_STEPS` `TPB`: enabled, `round: 2`, step `tpb`. TPB is a **global** role (no result type on its grant): its row covers every type, and the user's program scope still applies (DD-T9) |
| Scope (DD-T2) | A TPB row covers a membership only when its Lead (step-3) assessment ended `escalated`: `MembershipFacts.leadEscalated` in `rowCovers`, `leadEscalatedSql()` in `reviewerRowCondition`. A finished result stays listed (OQ-2). Writes only while step 4 is open (an Admin acting as TPB: any date) |
| Membership read | `leadAssessment` (the step-3 row by the timeline's `lead_assessors` step, `leadStepSql()`), whatever the current step. `heldAt` finds the caller's own row in it, so a Lead write after the TPB started is still `ASSESSMENT_FINISHED` |
| Own step (DD-T7) | The view of a reviewer reads ITS OWN step's assessment (`ownAssessment`): the Lead keeps its step-3 review after the TPB starts, and a TPB with no write yet reads none. The header status still reads the current step (DD-3) |
| Status (DD-T3) | `statusOf` / `statusSqlCase` take a fifth input, `currentStep` (the audience of the current assessment's step; `currentStepAudienceSql`). `tpb` + `pending` is Pending for TPB review; `tpb` + `escalated` is Pending PPU. A reader that leaves it out (the SP view) never matches those rows |
| Items | Live `escalated` comments of the round-1 assessment and of the Lead's step-3 one (`isTpbDecidable`). The view reads them in ONE statement (`findEscalationThread`, two decision joins: the TPB's `decision`, the Lead's `leadDecision`) plus `round` |
| Decisions | `PUT …/decisions/:commentId` with `tpb_agree_program` / `tpb_agree_assessor` (reason 1-2,000), stored with `role_code = 'TPB'` on the step-4 row (created on the first write, pinning the **Lead's** version, DD-T4). Changeable or cleared until the end. A Lead value is 409 `ASSESSMENT_DECISION_INVALID` for a TPB, and a TPB value for a Lead |
| Field green (DD-T8) | After each decision or clear the field's step-4 mark is set to `tpbFieldGreen`: green once EVERY escalated item on it sides with the program. Step-4 effective green: own mark, else the step-3 effective green (the Lead's mark, else the carried round-1 green) |
| End (DD-T1) | **Finish only**: no decision ends the review. Every escalated item needs a decision (`ASSESSMENT_CORE_UNDECIDED` with `fields`). Then `endRoundTwoOnFinish` with "escalated" = has a `tpb_agree_assessor`: all green is `quality_assessed` + one `qaed` release; else `escalated` (Pending PPU), no release. `applyTpbDecisions` writes `tpb_sided_program` / `tpb_sided_assessor` from `escalated` (actor `tpb`, `comment_events.actor_role = 'TPB'`) |
| Refusals | A TPB's validation, comment or delete is 403 `ASSESSMENT_READ_ONLY` (DD-T6). It records no AI usage (403) |
| Worklist counters | A caller whose only rows are TPB rows counts `pending_tpb_review` as pending and `quality_assessed` / `pending_ppu` / `unresolved` as finished. `pending_ppu` and `unresolved` are finished for everyone else too, but the PPU |
| Tests | `scope-tpb.spec.ts`, `round-two-tpb-rules.spec.ts`, `assessment-view-tpb.spec.ts`, `assessment.store-tpb.spec.ts`; e2e `test/assessment-round-two-tpb.e2e-spec.ts` (fixture `seedTpbWorld`) and `assessment-round-two-tpb-flow.e2e-spec.ts` (the Lead over HTTP, then the TPB) |

## Round 2: the PPU (P2-3917, spec `escalation/round-2-ppu`)

In step 5 the PPU closes the TPB's cases (comments the TPB decided `tpb_agree_assessor`). Contract: `docs/specs/escalation/round-2-ppu/front-contract.md`. Migration `0015_reporting_field_changes` (down script in `drizzle/rollback/`), for AC6 only.

| Piece | Rule |
|---|---|
| PPU row | `ROLE_STEPS` `PPU`: enabled, `round: 2`, step `ppu`, **`dateBound: false`** (DD-P1): `writeDecision` makes it writable whatever the state of step 5, as long as the timeline has the step. Global role: every type, the user's program scope (DD-T9) |
| Scope (DD-P4) | A PPU row covers a membership only when its TPB (step-4) row ended `escalated`: `MembershipFacts.tpbEscalated` in `rowCovers`, `tpbEscalatedSql()` in `reviewerRowCondition`. The membership read carries `tpbAssessment` (`tpbStepSql()`); `heldAt` and `ownAssessment` look there too (the TPB keeps its own view after the PPU starts) |
| Status (DD-P5) | Sixth input `ppuStepClosed` (the timeline's `ppu` step is closed): TS from `audienceStepState`, SQL as a per-timeline literal (`WorklistScope.ppuStepClosed`). `unresolved` = (tpb+`escalated` or ppu+`pending`) and closed; `pending_ppu` = the same, not closed. A reader that leaves it out never reads Unresolved |
| Items | Live `tpb_sided_assessor` comments of the round-1 and step-3 assessments (`isPpuDecidable`, choice `ppu_done`). The escalation thread adds the TPB's decision (`tpbDecision`, PPU view only, DD-P7) |
| Done (DD-P2, DD-P3) | `PUT …/decisions/:commentId` `{ decision: 'ppu_done', body? }` (body optional, `ValidateIf` in the DTO; stored `NULL`). The step-5 row pins the TPB's version. The field's step-5 mark = every case on it Done (`ppuFieldGreen`). The Done that leaves no case open and every core field green (`ppuEnds`) ends `quality_assessed` in the same transaction: one `qaed`, `applyPpuDecisions` (`tpb_sided_assessor → done`, actor `ppu`, event role `PPU`). `DELETE` clears a Done until the end; a clear never ends. No Finish |
| Step-5 green | Own mark, else the TPB's, else the Lead's, else the carried round-1 green (`ppuEffectiveOf`) |
| AC6 (DD-P6) | `open()` for a PPU reader on an open result: one `RESULTS_FEED.details` for the open cases' fields, compared with the snapshot by `changedFields` (the loader's rule); changed fields go to `reporting_field_changes` (insert-ignore: the first date stays). This GET writes that one table (an exception to "a read never writes"). Every round-2 reader of a result that reached step 5 reads the dates (`changedInReporting`, one statement). Any failure: `reporting_change_check_failed` warn (ids only), view unharmed. `RESULTS_FEED` is `@Optional()` in the service (unit specs build it by hand) |
| Refusals (DD-P8) | A PPU's Finish, validation, comment and delete are 403 `ASSESSMENT_READ_ONLY`; the AI is 403 (unchanged) |
| Counters | PPU-only callers: `pending_ppu` and `unresolved` pending, `quality_assessed` finished |
| Tests | `round-two-ppu-rules.spec.ts`, `scope-ppu.spec.ts`, `assessment-view-ppu.spec.ts`, `assessment.store-ppu.spec.ts`; e2e `assessment-round-two-ppu.e2e-spec.ts` (fixture `seedPpuWorld`), `-ppu-reporting` (AC6), `-ppu-flow` (Lead → TPB → PPU over HTTP, and Unresolved then Done) |

## The QA Admin acting as a reviewer (spec `admin/acts-as-reviewer`, 2026-11-23)

A QA Admin is transversal: with the `X-Acting-Role` header it works on any result **as** `ASSESSOR`, `LEAD_ASSESSOR`, `TPB` or `PPU` (the enabled reviewer rows). Contract: step-1 `front-contract.md` § 2.1. Migration `0014_admin_acts_as_reviewer` (down script in `drizzle/rollback/`).

| Piece | Rule |
|---|---|
| Header | `acting-role.ts`: `@ActingRole()` parses it (unknown or disabled role: 400 `VALIDATION_FAILED` on the header), `asCaller` adds it to the user (`ReviewerCaller`). Every `AssessmentController` route takes it |
| Access | `resolveAccess(user, roles, isAdmin, actingRole)`: an Admin with a role gets ONE row of that role, `resultTypes: 'all'`, all programs, `byAdmin: true`, in place of its own grants' rows. A non-admin's role is ignored. `actsAsAdmin` / `actingRoleOf` read it |
| Dates (R2) | `writeDecision` makes a `byAdmin` row writable whatever its step state, as long as the timeline has the step (`no_step` otherwise). The withdraw window is waived for it too. Everything else is the role's: round (`rowCovers`), auto-validated, finished, ended, end rules, release |
| Authorship (R4) | `acted_as_admin` on `assessment_comments` and `comment_decisions`, `finished_as_admin` on `result_assessments`, set on the Admin's writes. Reviewers and admins read `author.admin` / `assessedBy.admin` (`reviewerAuthor`, present only when true). The SP queries never select them |
| View | ADMIN only: `actingRoles` (enabled roles of the membership's round whose step exists) and `actingRole` (the role honored, `null` when read-only) |
| Quick comments | A live ADMIN grant reads and saves any reviewer role's list |
| Conflict (R5) | `users/role-assignments.repository.ts`: the Assessor / Lead overlap rule is skipped for a user with a live ADMIN grant |
| Log | The `assessment` decision line adds `actingRole` and `asAdmin: true` for an Admin acting as a role |
| Tests | `acting-role.spec.ts`, `scope.spec.ts` (acting Admin block), `test/assessment-admin-acting.e2e-spec.ts` |

## Bindings (read before changing credentials, tables or the clock)

DD-1. `AssessmentModule` imports `UsersModule` and `FieldConfigModule` **only among the feature modules**; "only" does not cover the infrastructure modules it also imports (`DrizzleModule`, `DynamoDbModule`, `ConfigModule.forFeature(catalogsConfig)`). It does not import `IngestionModule` (it exports nothing) or `TimelinesModule`. It binds its **own** copies, the way `IngestionModule` does:

- `TIMELINE_LOADS` = `DrizzleTimelineLoads` (the "has a load" probe of the step states). The ack builds `new DrizzleLoadsStore(tx)` itself on the transaction handle (`assessment.unit-of-work.ts:93`) for `endAsReleasedQaed` / `endAsReturned`. The `{ provide: LOADS_STORE, useClass: DrizzleLoadsStore }` provider at `assessment.module.ts:81` is not injected by anything in this module today; it is a leftover copy of ingestion's binding. Do not rely on it.
- `SNAPSHOT_STORE` = `DynamoSnapshotStore`. A change to the table or key schema in ingestion must be mirrored here.
- `RESULTS_FEED` = `ReportingResultsFeedClient`: a **second binding**. A change to its credential, URL or timeout in ingestion's binding must be mirrored here, or releases go out with different credentials than the loads.
- `FIELD_CATALOG_SOURCE` comes from `FieldConfigModule` (exported on purpose): one catalog cache shared with admin-config. Ingestion still has its own.
- Clock: `ADMIN_CONFIG_CLOCK` (the only time source of the services, NFR-4) and `IDEMPOTENCY_CLOCK`. The two clock factories at `assessment.module.ts:85` and `:88` are the **allowed clock binding**: the NFR-4 check (`tasks.md` T-10: a grep for the date constructor and the epoch-now call over non-spec files of this folder) must show only that file. Any other hit is a defect. This guide therefore never writes those two literals.
- `IDEMPOTENCY_REPLAY_READER` answers a comment create whose answer was not stored: it re-reads the comment from the stored id.

## Lock order and retries

Order of every write: **timeline row `FOR SHARE`** (`lockTimelineShared`; the lock a timeline edit waits on) → **`result_assessments` row `FOR UPDATE`** (`ensureAssessment`, then `lockAssessment`) → children (validations, comments, events, audit row, release row). READ COMMITTED. The service issues the calls in that order; the store never reorders them. A load's start takes the timeline `FOR UPDATE`; its lots and its end take it `FOR SHARE` (`loads.unit-of-work.ts`), the same as a write here; no load touches an assessment row. A withdraw takes the assessment row too, so a finish that counts non-withdrawn comments waits for it.

- **Deadlock (1213):** the whole unit of work is rerun, at most 3 attempts (`DEADLOCK_ATTEMPTS`). The victim is rolled back whole.
- **Pinned version:** a row that pins another field-configuration version than the one the request judged by sends the request round once more with the same clock; a second mismatch is 503 `SERVICE_UNAVAILABLE`, nothing committed.
- **`design.md` § 5 says "no cycle". That is too strong.** `ensureAssessment` (assessment row, then `timeline_results`) against the release ack (`timeline_results` through the membership end) can deadlock. The 1213 retry resolves it. Do not "fix" it by removing the retry.
- **Open gap (T-5):** a load's end takes the timeline `FOR SHARE`, as the ack does, so the ack's `endAsReturned` does **not** wait for `countReturnedNotResubmitted`. The two can interleave, so the count a load stores may not include a return the ack makes in the same instant. Not closed in this spec.

## Release outbox (FR-18)

- `ReleaseService` is the **sender**. An end only inserts the row; `dispatch()` runs after the commit and is never awaited by the request (NFR-6).
- **One claim = one send batch:** one phase year, at most 50 rows, no result id twice. `claimDue(clock, leaseMs, limit)` reads the clock **inside its own transaction**, so a wait for the pool is not taken from the lease. Rows are read `FOR UPDATE SKIP LOCKED`, then leased by one conditional `UPDATE … WHERE status = 'pending' AND (lease_until IS NULL OR lease_until < now)`; an affected-rows count different from the rows read throws `release_claim_mismatch` and rolls back.
- **Locked-year pass:** `buildDueYears` lists the phase years that have a due row, oldest first. If every row of the first year is held by another dispatcher, the claim tries the next year instead of ending the sweep.
- **Lease guard:** `WORST_CASE_SEND_MS` (3 attempts at the feed timeout plus the two waits with +20 % jitter) must stay below `RELEASE_LEASE_MS` (60 s); checked at module load and by a test. Before sending, if the clock is already past `leaseUntil − WORST_CASE_SEND_MS`, the batch is skipped (`lease_short` in the log) and left `pending`; the lease runs out and the next sweep takes it.
- **Backoff in the lease (no column):** after a failed send, an unanswered row or a rolled-back ack, `ReleaseService.defer` sets `lease_until = now + min(60 s × 2^(attempts−1), 30 min)` (`releaseBackoffMs`; `attempts` counts the claim that failed: 1, 2, 4, 8, 16 min, then 30). One conditional `UPDATE … WHERE id IN (…) AND status = 'pending' AND attempts = ?` per distinct attempt count; the `attempts` fence (it rises on every claim) keeps a dispatcher whose lease ran out from relabelling a row another dispatcher re-claimed. The claim already skips a leased row, so the lease doubles as "next attempt at". A failing defer is logged (`defer_failed`) and never throws: the claim's own 60 s lease still holds.
- **Admin retry ignores the backoff, never a send in flight:** `dispatch({ ignoreBackoff: true })` claims, besides the null/past leases, those later than `claim clock + RELEASE_LEASE_MS + IN_FLIGHT_TOLERANCE_MS` (30 s: `datetime` rounding plus the clock skew between API instances, assumed well under 30 s). A send in flight never puts a lease beyond `claim clock + RELEASE_LEASE_MS`; only a backoff does. **Limit:** the retry leaves to the sweep any row whose backoff ends within that tolerance (about 90 s from now), and this includes the whole first backoff (60 s) — such a row is sent by the next sweep, within about 3 minutes (≤ 90 s backoff + one jittered interval). Also `skipIds`: one retry call never takes a row it already claimed, or a row whose new backoff is long would be sent once per round.
- **Sweeper (`release-sweeper.ts`):** self-rescheduling `setTimeout` (never `setInterval`), ±20 % jitter, `unref()`, armed on bootstrap, re-armed after each sweep (so sweeps never overlap), errors logged with a fixed word (`sweep_failed`). Each sweep is `dispatch({ maxRounds: 1 })` in a loop while rows were claimed and the sweeper is not stopping, then `reportStuck()`. `beforeApplicationShutdown` (before the pool closes) clears the timer and awaits the sweep in flight, which ends after the batch in hand. `RELEASE_SWEEP_INTERVAL_MS=0` arms nothing. Two instances: the leased claim sends a row once.
- **`release_stuck`:** a `pending` row with `attempts ≥ 10` logs one `assessment_release` warn line per sweep (`outcome: release_stuck`, `releaseId`, `attempts`); the row stays `pending` (only Reporting refuses).
- **Retries:** only `FeedError` kind `unavailable` (5xx, timeout, network), 3 attempts, 1 s then 4 s. A 401 or 400 is not retried and the row stays `pending`.
- **Ack order (one transaction per batch):** timelines `FOR SHARE` (sorted) → assessments `FOR UPDATE` (sorted) → conditional settle (`id = ? AND status = 'pending'`) → membership end (`qaed` → `endAsReleasedQaed`; `not_qaed` → `endAsReturned`, round 1 only) → audit row. Reporting's `released` and `not_in_qa` settle as `sent`; any other reason settles as `refused` (reason trimmed to 32); an unanswered item stays `pending`.
- **Refused is final.** `/retry` picks `pending` rows only. A refused row is listed, never resent, and its membership stays active.
- `/retry` runs at most 3 batches (`RETRY_ROUNDS`); an automatic dispatch at most 50. `stillPending` counts only claimed rows. The list is capped at 500 with no truncation flag; a leased row counts as `pending`.

## Rules

- **Time only through `ADMIN_CONFIG_CLOCK`**, read once per request, judged in Rome minutes.
- **A write is checked with the caller's role row, not just `canReview`.** ADMIN holds every permission (P-35) and writes through this module only with `X-Acting-Role`, as that role's `byAdmin` row; otherwise `ASSESSMENT_READ_ONLY`.
- **Out of scope looks like missing:** the same 404 body. The bodies are byte-equal but not time-equal; this is accepted.
- **The status is computed on read, never stored.** Change the table in `qa-status.ts` only.
- **The database carries the invariants:** one assessment per membership and step, one release per assessment, one quick comment per role and text hash. A lost race is a typed 409 or a no-op, never a duplicate row.
- **Idempotency retention.** `idempotency_keys.response_body` keeps the comment body, the value copy and the author's nickname until the key's retention purge. A withdraw does not clear it. Do not add data to a keyed answer that the purge window should not hold.
- **Typed errors from the catalog.** A new `ASSESSMENT_*` code goes in `common/error-codes.ts` and in `front-contract.md` (section 9). A code in `assessment.errors.ts` missing from the contract is a review failure: `grep -o "ASSESSMENT_[A-Z_]*" assessment.errors.ts | sort -u` must equal the same extraction from the contract.
- **Comment replay differs by path.** A completed key replays the stored first answer (the comment as it was, `open`). The crash window (committed, answer not stored) replays through `replayComment`, which re-reads the comment now, so after a withdraw it shows `withdrawn`. `created_at` and `withdrawn_at` are cut to whole seconds so a replay equals the 201.
- **`ASSESSMENT_CORE_UNCOMMENTED` carries `fields` as a `string[]` of field keys**; the filter forwards it for that code only.

## Logging (FR-22, NFR-5)

- One `event: 'assessment'` JSON line per write request, success or refusal, written by a service-level wrapper (`loggedWrite`), not an interceptor: `action` (`validate`, `comment`, `withdraw`, `finish`, `quick_comment_save`), `timelineId`, `membershipId`, `outcome` (`ok`, `refused`, `error`), `reason?` (the error code, `http_<status>`, or `internal_error` for a non-HTTP failure), `requestId`, `actorId`.
- `event: 'assessment_release'` lines come from the dispatcher: ids, counts and fixed words (`claim_failed`, `lease_short`, `send_failed`, `unanswered`, `ack_failed`, `defer_failed`, `stuck_read_failed`, `release_stuck`, `sweep_failed`, and the ack decisions).
- A refusal raised before the service runs (the validation pipe, a guard, the idempotency interceptor) never reaches `loggedWrite` and writes no `assessment` line.
- **No title, value, label, comment body, nickname, name or email in any line.** `assessment-log.ts` has no way to receive one.
- **No `assessment` line on an idempotent replay** (the interceptor answers it) **and none on `POST /assessment-releases/retry`** (the dispatcher writes its own lines). Accepted gap: an admin retry is not tied to its caller in the logs.

## Testing

- Pure rules and services over in-memory stores: the `*.spec.ts` files beside the code (`qa-status`, `scope`, `role-steps`, `assessment-rules`, `comment-transitions`, `assessment-view`, the three service specs, `release.service.spec.ts`, `assessment.unit-of-work.deadlock.spec.ts`).
- HTTP suites in `server/test/assessment-*.e2e-spec.ts` and `quick-comments.e2e-spec.ts`, over the world in `server/test/support/in-memory-assessment.ts` built by `assessment-app.ts`. See `server/test/AGENTS.md`.
- **Never hand-build a `SNAP#…` key.** `snapshot_sk` is written by the loader; use `real-load-writer.ts` (`runRealLoad`), which runs a real `LoadRunner` over the in-memory loads world. A literal key without the prefix is the blindness that suite closes.
- Every builder that loads `AppModule` and calls `init()` wraps the builder in `withoutTitleBackfill` (the backfill would otherwise reach for a database the e2e apps do not have).
- The HTTP concurrency suites use the fake's `holdLockUntil` barrier, so only the conditional UPDATEs decide there. **Real row-lock order, `SKIP LOCKED`, `buildDueYears` under `ONLY_FULL_GROUP_BY` and the clock read after a pool wait are checks against real MySQL** (the API HITL, T-16).
