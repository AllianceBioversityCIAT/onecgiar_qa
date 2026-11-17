# AI suggestions on AI-input fields — Tasks

> Status: **approved 2026-11-17** (back lead). Back tasks first; T-6 waits for assessment T-19 on `dev`.

## Dependency graph

```
T-1 (gate) ─┬→ T-2 (contract, entities) ─┬→ T-4 (enqueue) ──┐
            └→ T-3 (eligible fields) ────┤                  ├→ T-7 (API HITL TEST, 20-nov) ══ M1 23-nov
                                         └→ T-5 (GET) ──────┤
assessment T-17 → T-19 ──────────────────→ T-6 (chip) ──────┘
                                           T-5 → T-8 (0010 + events) ─┐
assessment T-20 ─────────────────────────→ T-9 (copy/events) ─────────┼→ T-12 (UI HITL) → T-11 (PROD) ══ M2 1-dic
                                           T-8 + T-20 → T-10 (reason)─┘
```

## Dependencies on the assessment spec (`assessment/step-1-assessment`)

| Assessment task | Status on `dev` 17-nov | What this spec needs from it | If late |
|---|---|---|---|
| T-16 API HITL | open | The assessment view and scope used by FR-4's 404 behave on real MySQL | T-5 reuses the service, not the HITL; no block |
| T-17 client transport | `[ ]` | `ApiClient`, envelope, error model for `ai-suggestions-api.ts` | T-6 builds on T-17's branch or waits |
| T-16 role rows (later stories) | LEAD/TPB/PPU rows disabled | FR-5b: AC1 Lead / AC2 / AC3 end-to-end | pure-function tests only until enabled |
| T-19 Review read | `[ ]` (assessment agent) | `review.mapper.ts` with the `ai` slot (`ai: null`), `review-view` on the API | T-6 waits; Plan B for 23-nov (proposal § 5) |
| T-20 Review actions | `[ ]` | Comment box + save (copy target, `commentId` for `comment_saved`), validate call (reason before it) | T-9 and T-10 slip; M2 at risk only if T-20 is not on `dev` by 25-nov |
| T-21 UI HITL | `[ ]` | — (T-12 runs after it or with it) | none |

Rule: this spec does not edit `review-store.ts`, `review.mapper.ts` or `review-comments-drawer.ts` while their assessment task is open; it adds one input to each in a PR on top.

---

## T-1: Settle the open questions (gate) — 17-nov
- **Status:** [x] answered 17-nov (requirements § 4)
- **Size:** XS · **Depends on:** approval
- **Scope:** OQ-1…OQ-6 answered in `requirements.md` § 4 (defaults otherwise); T-17/19/20 owner and dates from Yeck
- **Done when:** the table has no "ask"

## T-2: Contract copy, ElectroDB entities, contract test — 18-nov
- **Size:** S · **Depends on:** T-1 · **Req:** NFR-4, FR-4
- **Scope:** `server/src/ai-suggestions/contract/**` (+ `SOURCE.md`, hash manifest, sync script); `entities/ai-suggestion.entity.ts`, `ai-run.entity.ts`; `test/ai-contract.spec.ts`; dev dep `ajv` (+ `ajv-formats` if needed)
- **Tests:** examples read back through the entity query; schema validation helpers; drift check
- **Falsifier:** default casing on the sk → the example query returns 0 items (red); edit one byte of a copied schema → drift test red
- **Done when:** server command green, both falsifiers observed red

## T-3: Eligible fields — 18-nov
- **Size:** S · **Depends on:** T-1 · **Req:** FR-1
- **Scope:** `ai-config.ts` (`production.json` loaded once; `eligibleFields(resultTypeKey, effectiveConfig)`)
- **Tests:** table test over the 7 fields × result types × `isAiInput`; status filter (`pending` only)
- **Falsifier:** drop the `isAiInput` check → the "not marked" case red

## T-4: Enqueue from the sync + re-enqueue route — 18/19-nov
- **Size:** M · **Depends on:** T-2, T-3 · **Req:** FR-2, FR-3, NFR-1, NFR-2, NFR-5
- **Scope:** FR-3b (startup warning, `GET /timelines/:timelineId/loads/:loadId/ai-jobs` status, 409 `AI_JOBS_DISABLED`); `@aws-sdk/client-sqs`; env `AI_JOBS_QUEUE_URL` (optional, DD-4) in `env.validation.ts`; `ai-jobs.port.ts`, `sqs-ai-jobs.ts`, `ai-enqueue.service.ts`; one call in `load-runner.ts` after `recordLot`; `POST /timelines/:timelineId/loads/:loadId/ai-jobs` (ADMIN); `aiRun.expected` UpdateItem
- **Tests:** runner spec with a fake publisher (jobs per lot, retry of a lot → same bodies, `expected` set not added); publisher failure → load `completed`, one log line; re-enqueue e2e (ADMIN only); bodies validated against `ai-job-message.schema.json`
- **Falsifier:** let the publisher error propagate → the "load completes" test red; `ADD expected` → the lot-retry test red
- **Consumers:** `load-runner.ts` constructor (all runner specs get the no-op adapter)

## T-5: GET ai-suggestions — 19-nov
- **Size:** M · **Depends on:** T-2, T-3 · **Req:** FR-4, FR-5, FR-9 (null until T-8), NFR-1
- **Scope:** controller + service; reuses the assessment scope/404 helper; one Query
- **Tests:** e2e per role (ASSESSOR, LEAD, TPB with copied fields, PPU 403, ADMIN); `pending` for an eligible field not stored; out of scope = same 404 body as the assessment view; every response Ajv-valid; OpenAPI suite updated
- **Falsifier:** return stored items without the eligible filter → the "field not in production" test red

## T-6: Chip on Review — 18–20-nov
- **Size:** M · **Depends on:** T-5 (fixtures earlier), assessment T-17/T-19 · **Req:** FR-6, NFR-1
- **Scope:** `ai-suggestions-api.ts`, `ai-suggestions-store.ts`, `ai-chip.ts`, `AiVm` widened (DD-7), one input in `review.mapper.ts` / `review-view`. Plan B: flag off by default, dev/test environments only, PROD build fails when on (spec test on the environment files + a build check); deleted with Plan A
- **Tests:** chip spec per view (green, amber, red label "Review", IRL/IUL with quote, unavailable reasons incl. `no_supporting_quote`, pending, request error); PPU renders nothing
- **Falsifier:** label red as "Incorrect" → spec red

## T-7: API HITL in TEST — 20-nov (gate for M1)
- **Size:** S · **Depends on:** T-4, T-5, `sqs:SendMessage` in TEST
- **Scope:** confirm the QA API TEST env `DYNAMODB_TABLE_NAME = cgiar-qa-test`; one real sync of a small timeline → messages in `qa-ai-suggestions-test` → items + `aiRun` (`produced + unavailable = expected`, `failed = 0`) → GET as assessor and TPB; DLQ empty. Evidence (ids and counts only) in `execution.md`
- **Done when:** the run is complete and M1 go/no-go (Plan A or B) recorded

## T-8: Migration 0010 + events — 24/25-nov
- **Size:** M · **Depends on:** T-5 · **Req:** FR-8, FR-9, NFR-3
- **Scope:** `0010_ai_suggestion_usage.sql` + rollback + Drizzle schema; `ai-usage.store.ts`; POST events; `copiedByReviewer`/`editedByReviewer` in GET (TPB only); `shown` stores `ai_level` + `reported_level` from the item; FR-11 route
- **Tests:** e2e per action (dedupe 204, `comment_saved` of another field → 400, `validated_above_ai` diff 1 → 400, `aiLevel` ≠ stored → 400, reason with a newline / 201 chars → 400, unavailable → 404, TPB/PPU 403); schema test that the table has no user column
- **Falsifier:** accept diff ≥ 1 → red; store the comment text → privacy test red

## T-9: Copy to comment + usage events (client) — 24/25-nov
- **Size:** S · **Depends on:** T-6, T-8, assessment T-20 · **Req:** FR-7, FR-8
- **Tests:** copy fills the box, nothing saved; `shown` once; `comment_saved` only after a copied save; event failure never blocks

## T-10: Reason before validating IRL/IUL (client) — 25/26-nov
- **Size:** S · **Depends on:** T-8, assessment T-20 · **Req:** FR-10
- **Tests:** diff ≥ 2 opens the dialog, empty reason disables save, cancel saves nothing, event then validate order; diff 1 → no dialog
- **Falsifier:** validate before the event → order spec red

## T-11: PROD readiness — 26/27-nov
- **Size:** S · **Depends on:** T-7, T-8 · **Scope:** PROD queue URL + `sqs:SendMessage` (Cris), PROD `DYNAMODB_TABLE_NAME` = worker's `cgiar-qa-prod`, `production.json` copy = worker's PROD version, migration 0010 on staging, smoke sync on staging. Checklist in `execution.md`; no infra changed by us

## T-12: UI HITL — 26-nov
- **Size:** S · **Depends on:** T-6, T-9, T-10 · Chip, copy and reason at 360 / 768 / 1440 px, contrast of the three signals in light and dark, keyboard path; Juanpa and Yeck sign off DD-7

## Coverage

| Req | Tasks |
|---|---|
| FR-1 | T-3, T-4, T-5 |
| FR-2, FR-3 | T-4, T-7 |
| FR-4, FR-5 | T-5, T-7 |
| FR-6 | T-6, T-12 |
| FR-7 | T-9 |
| FR-8, FR-9, FR-11 | T-8 |
| FR-10 | T-10 |
| NFR-1 | T-4, T-5, T-6 |
| NFR-2, NFR-3 | T-4, T-8 |
| NFR-4 | T-2 |
| NFR-5 | T-4, T-5 |

## Budget

12 tasks (9 build, 3 gates/HITL). Production LOC ≈ 1,300 (server ≈ 800, client ≈ 500), test LOC ≈ 1,800.
