# AI suggestions on AI-input fields — Requirements

## 1. Jira acceptance criteria (P2-3918, read 2026-11-17)

| AC | Text (short) | FR |
|---|---|---|
| AC1 | Assessor and Lead Assessor see a suggestion on every AI-input field | FR-1, FR-4, FR-5 |
| AC2 | TPB sees it read-only, with whether the reviewer copied it | FR-5, FR-9 |
| AC3 | PPU does not see it | FR-5 |
| AC4 | Signal green/amber/red + short explanation | FR-6 |
| AC5 | Uses field content and the result's evidence | worker (done); FR-2 sends the snapshot key |
| AC6 | The AI never validates or comments on its own | FR-7 |
| AC7 | Copy the explanation into a comment, editable before saving | FR-7 |
| AC8 | "Suggestion not available" and normal assessment otherwise | FR-6 |
| AC9 | Record shown / copied / edited / final decision; measure the AI, never the reviewers | FR-8, FR-9, FR-11, NFR-3 |

## 2. Functional requirements

**FR-1 Eligible fields.** For a membership with status `pending` (not `auto_validated`, not `not_in_qa`), the eligible fields are the keys in `production.json.fieldKeys` whose visibility is **`assessed`** in the configuration the membership is judged by (`effectiveFor(cycleId, timelineId, resultTypeKey)`, or the version its assessment pinned) and that exist in that result type's catalog. **The admin's `isAiInput` flag is not read** (changed 2026-11-17, back lead at Yeck's request): the Fields screen has had no AI column since 2026-11-11, so it cannot be set. The story's "field marked as AI input" (AC1) is therefore read as "Assessed field covered by the AI production contract".
- *Scenario:* an innovation_dev result in a timeline whose published configuration has the 5 tags and IRL Assessed → 6 jobs; IUL is not in its type → no job.
- BUT an Assessed field not in `production.json` → no job and no `pending` (it shows nothing); a production field that is View only or Hidden → nothing either.

**FR-2 Enqueue.** After `recordLot` commits a lot, the runner sends one SQS message per (membership inserted or re-submitted in that lot, eligible field), body per `ai-job-message.schema.json`: `{runId: "load-<loadId>", resultCode, snapKey, fieldKey, promptVersion}`. Batches of 10 (`SendMessageBatch`).
- AND IT MUST set the run counter `AIRUN#load-<loadId>` / `RUN`: `expected` = jobs sent so far in this load (`SET expected = :n`, `createdAt = if_not_exists`, `__edb_e__`/`__edb_v__` = if_not_exists), never `ADD` on `expected`, so a lot retry does not double it.
- *Idempotent:* a retried lot or a re-enqueue sends the same keys; the worker skips a stored item (C-6), and only `failed` items are replaced.
- BUT an SQS or DynamoDB failure never fails the lot or the load: it is retried (3 tries, 1 s / 4 s) and then logged once per lot as `event:'ai_enqueue'` with `loadId`, counts and `outcome: failed`; the load completes.

**FR-3 Re-enqueue.** `POST /api/v1/timelines/:timelineId/loads/:loadId/ai-jobs` (ADMIN) recomputes the jobs of the load's current `pending` memberships (FR-1) and sends them again. Returns `{expected, sent, failed}`. Safe to repeat.

**FR-3b No silent disable.** With `AI_JOBS_QUEUE_URL` unset the API logs one warning at startup (`ai_jobs_disabled`), the sync logs `outcome: disabled` per load, and both admin routes (`POST` re-enqueue, `GET /api/v1/timelines/:timelineId/loads/:loadId/ai-jobs` run status `{runId, expected, produced, unavailable, failed, complete}`) answer 409 `AI_JOBS_DISABLED` "AI disabled: no queue configured." (back lead, 17-nov).

**FR-4 Read.** `GET /api/v1/timelines/:timelineId/results/:resultCode/ai-suggestions` returns one view per eligible field of the membership's snapshot, validated against `ai-suggestion-view.schema.json`:
- stored `available` → `available` view (signal, suggestedValue, explanation, evidenceQuote, quoteVerified, evidenceSource, promptVersion, modelId, suggestionId);
- stored `unavailable` → `unavailable` + `unavailableReason`;
- eligible and not stored → `pending`.
- One DynamoDB Query: `pk = RESULT#<code>`, `sk begins_with AI#<snapKey>#`, filtered to the production `promptVersion`.
- Scope and 404 follow the assessment view (`timelines/:timelineId/results/:resultCode/assessment`): out of scope or not in the timeline → the same 404 body.

**FR-5 Roles.** ASSESSOR and LEAD_ASSESSOR: every view, `copiedByReviewer`/`editedByReviewer` omitted. TPB: same views, read-only, with `copiedByReviewer` and `editedByReviewer` (null until M2). ADMIN: same views, read-only, **without** the copied/edited mark (OQ-2: the mark says what a reviewer did; only TPB sees it, as the story asks). PPU: 403 `AI_SUGGESTIONS_FORBIDDEN`. Only the ASSESSOR role-step row is enabled today: TPB, LEAD_ASSESSOR and PPU get the assessment 404 until their rows are enabled (design § 3b).

**FR-5b Role dependency.** The audience rule is a pure function over every role (unit-tested now). Through HTTP it takes effect only for roles whose role-step row is enabled: today only ASSESSOR (and ADMIN read-only). TPB, Lead Assessor and PPU reach it when their stories enable their rows in `assessment/role-steps.ts`; until then they get the assessment scope's 404. **Dependency:** AC1 (Lead), AC2 (TPB) and AC3 (PPU) are verified end-to-end only after those stories (back lead, 17-nov).

**FR-6 Chip (client).**
- Impact Area tags: signal colour green / amber / red with the explanation; the red label reads **"Review"**, never "Incorrect".
- IRL / IUL (pilot, MG's decision): "Evidence explicitly supports level X" plus the quote, shown only when `quoteVerified`.
- `unavailable`: "Suggestion not available" + a human reason per code (incl. `no_supporting_quote` → "No quote in the evidence supports a level"). `pending`: "Suggestion in progress". The field stays fully assessable in every case.
- No chip on fields that are not eligible; nothing for PPU.

**FR-6b Indicative fields (contract 2.0.0, MG's scope change for December, back lead 2026-11-17).** Two more fields, on their own prompt version (`v1-1.0.0`; the 7 scored ones stay on `v2-1.0.0`): `general.result_type` (all result types, `valueKind: category`) and `innovation_use.current_use.actors` (`valueKind: use_numbers`, one suggestion that covers actors, organizations and measures; `projection_2030` is not included). Eligibility is unchanged (FR-1: in `production.json` and Assessed). The API reads each field's prompt version, value kind and scale from `production.json`, never hard-coded. Their view has `signal: "indicative"`, no colour and no quote; the chip reads "AI suggestion (indicative)" with "Indicative · no evidence quote", shows the suggested value and the explanation; category shows the suggested and reported category; use numbers shows the suggested numbers per user group next to the reported ones and says "covers actors, organizations and measures". "Copy to comment", `shown`, `copied` and `comment_saved` work the same; `validated_above_ai` and the reason stay IRL/IUL only. Usage rows of indicative fields store `ai_signal = indicative` and no levels (migration `0012`).

**FR-7 Copy to comment.** "Copy to comment" puts the explanation in the field's comment box, editable; nothing is saved until the reviewer saves. The AI never calls validate or comment.

**FR-8 Events.** `POST /api/v1/timelines/:timelineId/results/:resultCode/ai-suggestions/:suggestionId/events`, body per `ai-suggestion-event.schema.json`. ASSESSOR and LEAD_ASSESSOR only (TPB/PPU 403).
- `shown`: once per (suggestion, assessment); a repeat is 204 no-op.
- `copied`: once per (suggestion, assessment).
- `comment_saved {commentId}`: the comment must belong to this assessment and field; the server stores `edited = normalized(comment text) ≠ normalized(explanation)` and never the text.
- `validated_above_ai {aiLevel, validatedLevel, reason}`: field must be IRL or IUL; `aiLevel` must equal the stored `suggestedValue` and `validatedLevel` the snapshot's reported level; `validatedLevel - aiLevel ≥ 2`; `reason` one line, 1–200 chars. Otherwise 400 `AI_EVENT_INVALID` naming the rule.
- An unknown or `unavailable` suggestion → 404.

**FR-9 Copied mark.** TPB's `copiedByReviewer` = any `copied` row for that suggestion in the step-1 assessment of that membership; `editedByReviewer` = the last `comment_saved` row's `edited`.

**FR-11 Missing reasons (AC9 analysis).** `GET /api/v1/ai-suggestions/analysis/missing-reasons` (ADMIN) returns, per field key and prompt version, the count of IRL/IUL validations where the reported level is ≥ 2 above the AI level and no `validated_above_ai` event exists for that suggestion and assessment, plus the count that have one. Counts only: no assessment, membership or reviewer ids. The AI and reported levels come from the `shown` row (the server copies `suggestedValue` and `reportedValue` from the stored item, never from the client), so a suggestion never shown is not counted; the response says so (`basis: 'shown'`). If the count is high after the batch, the reason moves into `validate` (OQ-3).

**FR-10 Reason before validating (client, M2).** When the reviewer validates IRL/IUL and the reported level is ≥ 2 above the AI's `available` level, a one-line reason (required, ≤ 200) is asked before the validate call; the event is posted first, then the validation. Cancel = nothing saved.

## 3. Non-functional

- **NFR-1 Failure isolation.** No AI failure (SQS, DynamoDB, worker) blocks a sync, the assessment view or a validation. The Review page renders with the AI request failed (chip: "Suggestion not available").
- **NFR-2 Logs and privacy.** Logs carry ids and counts only (no titles, explanations, quotes, comment text or reasons). No secrets in env docs.
- **NFR-3 Measure the AI, not the reviewers.** `ai_suggestion_usage` stores no user id; reads aggregate by field, prompt version and signal only. No route returns usage per reviewer.
- **NFR-4 Contract.** A contract test fails if the repo copy drifts from the worker's schemas/examples, or if ElectroDB cannot read the examples.
- **NFR-5 Cost.** One Query per GET; enqueue adds at most 5 `SendMessageBatch` calls and one `UpdateItem` per lot of 50.

## 4. Open questions (defaults apply unless changed at T-1)

| # | Question | Default |
|---|---|---|
| OQ-1 | Enqueue for re-submitted (round 2) memberships too? | **Yes** (back lead, 17-nov) |
| OQ-2 | ADMIN reads suggestions? | **Yes, read-only, without the copied mark**; only TPB sees the mark (back lead, 17-nov) |
| OQ-3 | The reason: client-enforced only, or also refused in `validate`? | **Client only in December**, server checks the event; FR-11 counts the missing reasons; moves into `validate` after the batch if many (back lead, 17-nov) |
| OQ-4 | Which promptVersion the GET reads | **`production.json.promptVersion`** of the build (back lead, 17-nov) |
| OQ-5 | "Final decision" (AC9) | **Read from `assessment_field_validations` at analysis time** (back lead, 17-nov) |
| OQ-6 | Who owns assessment T-17/T-19/T-20 | **The assessment spec's agent**, not Yeck. Back first (T-2…T-5, T-8); the chip (T-6) starts when T-19 is on `dev` (back lead, 17-nov) |
