# AI suggestions on AI-input fields — Proposal

> **In one line:** every snapshot synced into a timeline queues one AI job per AI-input field; the Review page shows the stored suggestion as a chip the reviewer can copy into a comment, and the API records how the suggestion was used to measure the AI, never the reviewers (P2-3918).

## 1. Document Control

| Field | Value |
|---|---|
| Spec Path | `docs/specs/assessment/ai-suggestions/` |
| Type | Change |
| Deliverable | software (server + client) |
| Jira | P2-3918 (9 ACs), epic P2-3902, related P2-4098 (Built-in AI Helper). Read on 2026-11-17: Open, no comments |
| Approval Mode | gated |
| Branch / worktree | `feat/P2-3918-ai-suggestions` in `../onecgiar_qa-ai`, fast-forwarded to `origin/dev` @ `14ffaad` (the base had no commits of its own). Nothing is pushed until the back lead says so |
| Author | Claude Code (`claude-opus-5-5`) for the back lead (Juanda), 2026-11-17 |
| Requirement source | Jira MCP (ACs in `requirements.md` § 1) plus the back lead's brief |
| Contract source | `ai-services/ai-qa-helper` branch `dev-ai-qa-helper` @ `1233a1a`: `contract/schema/*.json`, `contract/examples/*.json`, `contract/production.json` (`v2-1.0.0`, 7 fields), README *Contract with onecgiar_qa* |
| Depends on | `assessment/step-1-assessment` (on `dev` through T-15; T-16 to T-21 open), `ingestion/timeline-sync` (archived), `admin-config/field-configuration` (archived: `is_ai_input`, `effectiveFor`) |
| Parallel-safe | no. It edits `load-runner.ts` and adds migration `0010` |

## 2. Intent

The AI worker is built and deployed in TEST (SQS `qa-ai-suggestions-test` → Lambda `qa-ai-worker-test` → Bedrock → DynamoDB `cgiar-qa-test`). Nothing in QA feeds it or reads it. This change adds the three integration points and the chip:

1. **Enqueue** — the sync sends the jobs and the run counter.
2. **Read** — `GET …/ai-suggestions` per result, by role.
3. **Measure** — `POST …/ai-suggestions/:suggestionId/events`, stored in `ai_suggestion_usage` (migration `0010`).
4. **Contract test** — the copy of the worker contract in this repo is checked against the worker's schemas and examples.
5. **Chip** on the Review page, plus "Copy to comment" and the one-line reason for IRL/IUL.

## 3. Current behavior

| # | Today | Source |
|---|---|---|
| C-1 | The sync writes the snapshot (`putSnapshots`) and then the memberships (`recordLot`) per lot of 50. No hook after it | `server/src/ingestion/load-runner.ts:449-462`, `:591` |
| C-2 | DynamoDB has one ElectroDB entity, `resultSnapshot` (`RESULT#<code>` / `SNAP#<snapKey>`). No `aiSuggestion` or `aiRun` | `server/src/database/dynamodb/entities/result-snapshot.entity.ts` |
| C-3 | No SQS client: `@aws-sdk/client-sqs` is not a dependency, no queue URL in env | `server/package.json`, `server/src/config/env.validation.ts` |
| C-4 | The field configuration has `is_ai_input` per field and version; `effectiveFor(cycleId, timelineId, resultTypeKey)` is the export the review stories read | `schema/field-config-version-items.ts:30`; `field-config.module.ts:51` |
| C-5 | The Review mockup already has an AI note (`review-ai-note.ts`) on `AiVm { mismatch, text, expanded }` and actions `ai-toggle/hide/dismiss/use`. Assessment T-19 maps `ai: null` and hides the note | `client/.../review/review-model.ts:39`, `:28-31`; assessment `tasks.md` T-19 |
| C-6 | The worker writes `aiRun` counters with `ADD` + `SET if_not_exists` on `__edb_e__`/`__edb_v__`; the item may exist before the API writes `expected` | `ai-qa-helper/app/worker/store.py:62` |

## 4. Scope

**In:** the five points above; an ADMIN route to re-enqueue a load's jobs; the TPB read-only view with the "copied" mark; PPU 403.

**Out:** an agentic chatbot; suggestions on fields that are not AI input or not in `production.json`; W3/Bilateral; the metrics job and any per-reviewer figure (AC9); infrastructure (queue, IAM, `sqs:SendMessage` — requested from Cris); prompt changes.

## 5. Plan and dates

Today is Tue 17-nov. Two milestones.

| Milestone | Date | Content |
|---|---|---|
| **M1 — test with MG in TEST** | Mon 23-nov (code on `dev` and deployed to TEST by Fri 20-nov) | Points 1, 2, 4 and the chip without the reason: T-1 … T-7 |
| **M2 — PROD** | Tue 1-dic (on `staging` by Fri 27-nov, Yeck's OK) | Point 3 complete (`0010`, events, reason), PROD readiness: T-8 … T-11 |

| Day | Back (Juanda) | Front | Gate |
|---|---|---|---|
| Tue 17 | T-1 open questions | — | **spec approval** |
| Wed 18 | T-2 contract + entities + contract test · T-3 eligible fields | T-6 chip component on fixtures (no page wiring) | |
| Thu 19 | T-4 enqueue + re-enqueue · T-5 GET | T-6 wiring into Review (needs T-19) | `sqs:SendMessage` in TEST (Cris) |
| Fri 20 | T-7 API HITL in TEST: one real sync → items in `cgiar-qa-test` → GET | T-6 on TEST | M1 go / fallback |
| Mon 23 | MG test | MG test | **M1** |
| Tue 24–Wed 25 | T-8 migration `0010` + events | T-9 copy / events · T-10 reason | |
| Thu 26 | T-11 PROD readiness (queue URL, permission, `production.json` version, smoke) | T-12 UI HITL | |
| Fri 27 | merge to `staging-center` → `staging` (Yeck) | | |
| Tue 1-dic | | | **M2 PROD** |

### Risk for 23-nov — the chip depends on the Review page on the API

Assessment T-17 (client transport), T-19 (Review read) and T-20 (actions) are all `[ ]` on `dev` today, and T-16 (API HITL) is still open. The chip lives inside T-19's page, so **if T-19 is not on `dev` by Thu 19-nov the chip cannot be shown on the real Review page on the 23rd.**

- **Plan A (preferred):** T-6 is built as a standalone component with its own store keyed by `(timelineId, resultCode)` and lands as one small PR on top of T-19 the day T-19 merges. No duplicated mapper or store code.
- **Cut-off: Thu 19-nov** (approved by the back lead, 17-nov).
- **Plan B (fallback for 23-nov):** if T-19 is not merged on Thu 19-nov, the MG session uses the **mockup Review page** (`review.mock.ts`) with only the AI note fed by the real `GET …/ai-suggestions` of a TEST result, behind a dev-only query flag. MG judges the suggestion's quality and wording, which is what the 23rd tests; validation and comments stay mock. The flag is **off by default**, can be on only in the dev/test environment files, and the **PROD build fails if it is on** (a build-time check). It is deleted when Plan A lands.
- The reason (point 3) is not needed on the 23rd, so T-20 is not on M1's critical path.

**Owner needed:** who owns T-17/T-19/T-20 on the front (Yeck?) and their dates. T-6 must not start editing `review-store.ts` / `review.mapper.ts` while T-19 is open (team `CLAUDE.md` § 3.4 rule on people working on a file now applies to devs too).

## 6. Infra check (read-only, 2026-11-17)

| Item | Result |
|---|---|
| Worker table in TEST | ✅ `qa-ai-worker-test` env `TABLE_NAME = cgiar-qa-test` |
| Queues in TEST | ✅ `qa-ai-suggestions-test` and `qa-ai-suggestions-dlq-test` exist (us-east-1) |
| QA API in TEST writes `cgiar-qa-test` | ⚠️ **not confirmed.** The QA API is not a Lambda or an ECS task in this account. To confirm from its host: `DYNAMODB_TABLE_NAME` of the TEST deployment must equal `cgiar-qa-test`. Part of T-7 |
| `sqs:SendMessage` for the QA API | ⏳ requested from Cris (TEST this week). T-4 ships with the publisher **off** when `AI_JOBS_QUEUE_URL` is unset, so merging does not depend on it |

## 7. Approval

Approve this spec (proposal, requirements, design, tasks) before any code is written. The open questions in `requirements.md` § 4 carry a default; T-1 settles them.
