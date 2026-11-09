# Timeline sync at any step — Tasks

Spec: `docs/specs/ingestion/timeline-sync` (requirements FR-1…FR-13, NFR-1…NFR-5; design DD-1…DD-10, P-1…P-14). Branch `feat/ingestion-timeline-sync`. Commits follow `<emoji> <type>(ingestion) P2-3906: …`.

Common verification (run from `server/`):
- `V-unit`: `npx vitest run <files>`
- `V-all`: `npx vitest run` (whole unit suite)
- `V-e2e`: `npx vitest run --config ./vitest.config.e2e.ts --maxWorkers=2`
- `V-static`: `npm run lint && npm run build`

**BA gate (KZ-ingestion--step-1-loads-1):**
- **T-6 step 4** (classifying a re-submitted result, S-9 / DD-4) waits for Angel's answer on S-9, or for the back lead's named acceptance ("S-9 accepted as default by <name>, <date>") recorded in `requirements.md` Document Control.
- **T-8** (front contract and the AC text) waits for the same answer, plus the replacement AC (proposal § 9.4).

## Dependency graph

```text
T-1 (migration, schema) ─┐
T-2 (round limit) ───────┼─> T-3 (pure rules) ─> T-4 (store, unit of work) ─┐
T-5 (snapshot get) ──────┴──────────────────────────────────────────────────┴─> T-6 (runner) ─> T-7 (service, models, e2e) ─> T-8 (docs) ─> T-9 (HITL)
```

T-1, T-2 and T-5 are independent: they touch different files, and only T-1 touches `server/src/database/**`. They may run in parallel (width 2).

**PR plan:**
- PR 1: T-1…T-5 (rules and persistence);
- PR 2: T-6, T-7 (runner, service, e2e);
- PR 3: T-8 (documents).

---

## T-1: Migration `0008` and the schema of rounds

- **Status:** [x]
- **Size:** M
- **Depends on:** none
- **Requirements:**
  - FR-5 (Scenario: Two rounds; Duplicate insert);
  - FR-6 (`end_reason` gains `returned`);
  - FR-2 (load `round`, `step_position`);
  - FR-8 (columns);
  - NFR-1, NFR-3, NFR-5;
  - FR-10 ("loads before this spec read as round 1, position 1": the defaults).
- **Design refs:** § 5.1, § 5.2; DD-2, DD-5; P-4, P-9, P-11
- **Scope:**
  - **First step, settling P-9:** count the top-level keys per type from the field-config catalog source and record the maximum in `execution.md`. Set the `changed_fields` CHECK to that maximum, rounded up to the next multiple of 32, and never above 256.
  - `schema/timeline-results.ts`:
    - `entry_round` with its CHECK;
    - drop `uq_timeline_results_timeline_code`;
    - add `uq_timeline_results_timeline_code_round`;
    - `end_reason` + `returned` (`released_not_qaed` kept, S-7);
    - `previous_membership_id` (self FK);
    - `changed_fields` with its CHECK.
  - `schema/timeline-loads.ts`: `round` and `step_position` with their CHECKs.
  - `npm run db:generate` → `drizzle/0008_*.sql`. Read the generated SQL. The drop and the add must be in one migration, and the drop must come after the add or the table stays covered. Edit only if drizzle-kit orders it wrong, and record that.
  - The manual `drizzle/rollback/0008_*.down.sql`, in the `0006` header style. It refuses (a `SIGNAL` guard, or a documented pre-check `SELECT`) when any `(timeline_id, result_code)` has two rows.
  - `schema.spec.ts` pins (`:1888`, `:1907`, `:2001` and the loads table).
  - Not touched: any `src/ingestion/**` file. The key-name constant moves in T-4.
- **Tests:** `schema.spec.ts`: column types, enum values, both unique keys, the CHECKs, and the generated SQL text of `0008`.
- **Verification:** `V-unit src/database/drizzle/schema/schema.spec.ts`; `V-static`; then `V-e2e`. The e2e suites run on in-memory stores and never apply a migration (`server/vitest.config.e2e.ts`, `server/test/AGENTS.md`), so that `0008` applies on top of `0007` is proved only by the human `pnpm db:migrate` on `qadb`, recorded in T-9 (amended 2026-11-06, back lead).
- **Falsifier:** leave the old key in place (do not drop it). The pinned index list then has `uq_timeline_results_timeline_code`, and the spec goes red. Set the `entry_round` default to 0: the CHECK pin goes red.
- **Red run:** predicted — greenfield artifact (observed in T-1). The updated pins run red against the unchanged schema before the schema edit; quote the red in `execution.md`.
- **Disqualifier:**
  - The SQL pin was copied from the generated file after generation, so it pins whatever was produced. The expected SQL must be written from § 5.1 first.
  - `V-e2e` was skipped.
- **Consumers:** `server/src/database/drizzle/schema/schema.spec.ts`. The ingestion readers (`loads.store.ts`, `loads.unit-of-work.ts`, `loads.unit-of-work.spec.ts`, `test/support/in-memory-loads.ts`) follow in T-4 (P-11).
- **Review:** full — a migration that drops a unique key on a table with rows.
- **Done when:**
  - every column, key and CHECK of § 5.1 and § 5.2 is in `0008` and pinned;
  - the down script exists with its guard;
  - P-9 is recorded;
  - `V-static` and `V-e2e` are green.
- **Skills:** nestjs-expert

## T-2: Round limit in the timeline edit

- **Status:** [x]
- **Size:** S
- **Depends on:** none
- **Requirements:** FR-3 (Scenario: Round 3; BUT: rounds 1 and 2 validated as today)
- **Design refs:** § 7.6; DD-9; P-6
- **Scope:**
  - `admin-config/timelines/timeline-rules.ts`: export `MAX_ROUND = 2`; add the issue `ROUND_ABOVE_MAX` on `steps[n].round`.
  - `common/error-codes.ts`: `FIELD_ERRORS.ROUND_ABOVE_MAX` with English copy ("A timeline has at most 2 QA rounds.").
  - Not touched: the client. `api-envelope.ts` is Yeck's, through the contract (T-8).
- **Tests:**
  - `timeline-rules.spec.ts`: rounds `1,1,2,2,3` → the issue on `steps[4].round`; `1,2,3` → both `ROUND_ABOVE_MAX` and nothing else on step 3, since the sequence is valid; `1,1,2,2,2` → no issue.
  - The existing `ROUND_SEQUENCE` cases are unchanged.
  - `error-codes.spec.ts`: the new key.
- **Verification:** `V-unit src/admin-config/timelines/timeline-rules.spec.ts src/common/error-codes.spec.ts`; `V-static`. Then `V-e2e`: the timeline create and edit suites stay green.
- **Falsifier:** change the check to `> 3`. The `1,1,2,2,3` case goes green on the buggy code, so it must be red.
- **Red run:** predicted — greenfield artifact (observed in T-2). Write the new cases first and quote their red.
- **Disqualifier:** a test that builds the issue list by hand instead of calling the real rule function.
- **Consumers:** `timeline-rules.spec.ts`, `error-codes.spec.ts` (`git grep -l "ROUND_SEQUENCE" -- server/src server/test client/src` → also `client/src/app/core/http/api-envelope.ts`, Yeck's, listed for T-8).
- **Review:** checklist — one rule beside an existing one.
- **Done when:** the three cases pass, existing timeline suites are green, and `MAX_ROUND` is exported.
- **Skills:** nestjs-expert

## T-3: Pure rules of a sync

- **Status:** [x]
- **Size:** M
- **Depends on:** T-1 (enum and column types), T-2 (`MAX_ROUND`)
- **Requirements:**
  - FR-1 (all 4 scenarios, as rule cases);
  - FR-2 (Boundaries; Round set by the admin);
  - FR-4 (all 6 scenarios; BUT no Reporting call is a T-6 concern; AND IT MUST: UTC, second precision, strict);
  - FR-8 (AND IT MUST: canonical form);
  - FR-9 (AND IT MUST: associative merge);
  - NFR-4.
- **Design refs:** § 5.3, § 7.4; DD-1, DD-3, DD-6, DD-8
- **Scope:** `src/ingestion/load-rules.ts`:
  - `syncWindow` (removes `loadWindow`);
  - `stepInForce`, `entryRound`;
  - `skipVerdict` v2 with the take kinds and `previous`;
  - `isResubmitted`;
  - `canonicalJson` (moved from `load-runner.ts`, re-exported for the runner) and `changedFields`;
  - the `LoadSummary` keys, `EMPTY_SUMMARY`, and `mergeSummary` (§ 5.3, `returnedNotResubmitted` not summed per lot; a round mismatch throws).

  Callers (`loads.service.ts`, `loads.unit-of-work.ts`, `load-runner.ts`) only change imports and signatures enough to compile. Their behavior changes in T-4…T-7.
- **Tests:** `load-rules.spec.ts`:
  - **`entryRound` / `stepInForce`:** a table over 3 timeline shapes: the default `1,1,2,2,2`; `1,1,1,2,2`; and a 1-step timeline. Rows: one minute before each opening, the opening minute, the closing minute, the gap minute after each close. A stored round of 3 throws.
  - **`syncWindow`:** last closing minute → open; +1 minute → `LOADS_WINDOW_CLOSED`; closed cycle first.
  - **`skipVerdict` v2:** each FR-4 case in round 1 and in round 2; S-6 with the other timeline open and closed; parallel scope with no membership; duplicates.
  - **`isResubmitted`:** equal second; +1 s; null; sub-second (`…:00.900Z` vs `ended_at …:00`) is not later.
  - **`changedFields`:** reordered keys → `[]`; one changed value; a key on one side only.
  - **`mergeSummary`:** a property test (random lots, every grouping and order → the same result); `loaded = loadedNew + loadedResubmitted`; a round mismatch throws.
- **Verification:** `V-unit src/ingestion/load-rules.spec.ts`; `V-all` (callers compile and step-1 suites stay green except the window cases named in T-4); `V-static`.
- **Falsifier:**
  - `stepInForce` using `<` instead of `≤` on `opensAt`: the "opening minute" rows go red.
  - `isResubmitted` with `>=`: the "equal second" row goes red.
  - `skipVerdict` ignoring `returned` in other timelines: the S-6 row goes red.
  - `changedFields` using `JSON.stringify`: the reordered-keys row goes red.
- **Red run:** predicted — greenfield artifact (observed in T-3). Write the tables first against stubs that return a fixed value, and quote the reds.
- **Disqualifier:**
  - A boundary table whose expected values were computed by calling the function under test.
  - A property test with fewer than 100 runs, or with lots that never carry the new keys.
- **Consumers:** `load-rules.spec.ts`, `load-runner.spec.ts`, `loads.service.spec.ts`, `loads.unit-of-work.spec.ts`, `test/ingestion-loads.e2e-spec.ts` (P-12; they compile here and are updated in T-4, T-6, T-7).
- **Review:** full — the rules every other task relies on.
- **Done when:** every listed row passes, `loadWindow` has no remaining import, and `V-all` is green.
- **Skills:** nestjs-expert, tdd

## T-4: Store and unit of work

- **Status:** [x]
- **Size:** M
- **Depends on:** T-1, T-3
- **Requirements:**
  - FR-1 (start refusals; BUT nothing written on a refusal);
  - FR-2 (round and position recorded; AND IT MUST: read at start under the lock);
  - FR-5 (Duplicate insert → skip, not a failed lot);
  - FR-6 (Return; Already ended; no-op cases);
  - FR-9 (the `returnedNotResubmitted` query; the unsubmitted case counted);
  - FR-10 (old loads read round 1, position 1);
  - FR-11 (`load_start` with the round);
  - NFR-1.
- **Design refs:** § 5.1–5.3, § 7.1, § 7.2, § 7.3 step 7 (the query), § 7.5; DD-2, DD-7, DD-10; P-4, P-5, P-10
- **Scope:**
  - `loads.store.ts`:
    - `findSteps` replaces `findStepOne`;
    - the new fields in `findMemberships`;
    - `RESULTS_TIMELINE_CODE_ROUND_KEY` replaces `RESULTS_TIMELINE_CODE_KEY`, and `MembershipDuplicateKey` → `'timeline_code_round'`;
    - `insertMembership` takes `entryRound`, `previousMembershipId`, `changedFields`;
    - `insertLoad` takes `round`, `stepPosition`;
    - `endAsReturned`;
    - `countReturnedNotResubmitted`;
    - `storedSummary` defaults.
  - `loads.unit-of-work.ts`: `start` per § 7.1; `recordLot` counts `loadedNew` / `loadedResubmitted` and maps the renamed key.
  - `test/support/in-memory-loads.ts`: the same contract, including the new unique key and `endAsReturned`.
  - Not touched: the runner and the service.
  - **Amended 2026-11-09 (back lead):** the step-1 window pins that the new start breaks are rewritten here, test-only, to the last step's close: 3 cases in `loads.service.spec.ts` (`LoadsService.start (FR-2)`), 2 in `test/ingestion-loads.e2e-spec.ts` (FR-2 POST), 1 in `test/ingestion-loads-privacy.e2e-spec.ts` (refusals). No service code; the preview window stays in T-7.
- **Tests:** `loads.unit-of-work.spec.ts`:
  - start at step 4 → 202 with round 2, position 4;
  - one minute after the last close → `window_closed`, with no row, audit or mark;
  - a closed cycle wins over the window;
  - the duplicate on the round key → `ALREADY_IN_THIS_TIMELINE` skip, lot recorded;
  - a round-2 insert beside a returned round-1 row → both exist;
  - `endAsReturned` on active round 1, on ended, on round 2, on a missing id;
  - `countReturnedNotResubmitted`, with one resubmitted, one listed-not-resubmitted and one unlisted;
  - a pre-`0008` summary read with defaults.

  Run the same cases against the in-memory store and the Drizzle store wherever the existing spec already does both.
- **Verification:** `V-unit src/ingestion/loads.unit-of-work.spec.ts`; `V-all`; `V-static`; `V-e2e`.
- **Falsifier:**
  - Map the renamed key to `ACTIVE_IN_OTHER_TIMELINE`: the duplicate-insert case goes red.
  - Drop `entry_round = 1` from `endAsReturned`'s condition: the round-2 case goes red.
  - Read steps before `findTimelineForUpdate`: a lock-order test that already exists (step-1 T-5) goes red, or else add one.
- **Red run:** predicted — greenfield artifact (observed in T-4) for the new methods. For the changed start window, the existing "closed after step 1" cases are rewritten first; quote their red against T-3's code.
- **Disqualifier:**
  - The duplicate-key case is asserted only on the in-memory store's own key logic, without the case also pinning the key name `RESULTS_TIMELINE_CODE_ROUND_KEY` that the Drizzle store maps. MySQL behavior itself is checked live in T-9 (amended 2026-11-06, back lead: the e2e suites have no database).
  - The returned count is tested with fixtures where every returned result is also listed by the feed.
- **Consumers:**
  - `loads.unit-of-work.spec.ts`, `test/support/in-memory-loads.ts`;
  - `test/support/ingestion-app.ts` (if it builds the store);
  - `admin-config/timelines/timeline-loads.ts` (reads `timeline_results`; must stay unchanged, P-10);
  - P-11 list.
- **Review:** lenses — concurrency and lock order (start under lock, duplicate-key mapping), plus a data lens (the defaults of old rows).
- **Done when:** every case passes on both stores where the existing spec runs both, `V-e2e` is green, and no `findStepOne` remains.
- **Skills:** nestjs-expert

## T-5: Snapshot read by key

- **Status:** [x]
- **Size:** S
- **Depends on:** none
- **Requirements:** FR-8 (the previous snapshot is read only when the hash differs, so this task gives the read); NFR-2
- **Design refs:** § 5.4
- **Scope:** `snapshot-store.port.ts`: `get(resultCode, sk) → record | null`. `dynamo-snapshot-store.ts`: one ElectroDB `get`, inflating `valuesGz` as `history` does. The in-memory snapshot store gets the same. Not touched: `put`, `history`.
- **Tests:** `dynamo-snapshot-store.spec.ts`: hit, miss → null, a gzipped item round-trip. `dynamo-snapshot-store.dynamo-local.spec.ts`: the same against DynamoDB Local when `DYNAMODB_ENDPOINT` is set.
- **Verification:** `V-unit src/ingestion/dynamo-snapshot-store.spec.ts`; `V-static`. Run the DynamoDB Local suite when it is available; when it is not, say so in `execution.md` (it is not a pass).
- **Falsifier:** return `values` without inflating `valuesGz`: the gzipped round-trip goes red.
- **Red run:** predicted — greenfield artifact (observed in T-5)
- **Disqualifier:** a test whose fake client returns the expected record for any key.
- **Consumers:** `snapshot-store.port.ts` implementers: `dynamo-snapshot-store.ts`, the in-memory store in `test/support/` (`git grep -l "SnapshotStore" -- server/src server/test`, run in the task).
- **Review:** checklist — one read method mirroring `history`.
- **Done when:** the three cases pass and the port has one more method, with no other change.
- **Skills:** aws-serverless, nestjs-expert

## T-6: Runner: verdict v2, re-entry, changed fields, final counts

- **Status:** [x]
- **Size:** M
- **Depends on:** T-4, T-5. **Step 4 waits for the S-9 gate** (see top).
- **Requirements:**
  - FR-4 (BUT no intake or details for a skip);
  - FR-7 (Re-submitted KP; BUT not re-classified, not released; Re-submitted as another type; Re-submitted as a KP; New KP in round 2);
  - FR-8 (Corrected title; Type changed — `["result_type_key"]`, no read; Nothing changed — no read; First time);
  - FR-9 (Unsubmitted program, end-to-end in the runner);
  - FR-11 (`load_end` with round and counts; logs ids only);
  - FR-12 (retry rules, KP release, Reporting order unchanged);
  - NFR-2, NFR-4.
- **Design refs:** § 7.3 (all steps), § 7.7; DD-3, DD-4, DD-5, DD-6, DD-7, DD-8; P-1, P-8
- **Scope:** `load-runner.ts` per § 7.3, steps 2 and 4–7. Not touched: the lease, the heartbeat, the retry policy, or G-1…G-3.
- **Tests:** `load-runner.spec.ts` over the in-memory world:
  - a round-2 run with: one new result, one re-submitted with a changed title, one re-submitted with the same hash, one returned-not-resubmitted but listed, one returned and unlisted, one active in an open other timeline, and one returned in an open other timeline (S-6);
  - assert the memberships (entry round, status, kp_group, previous id, changed fields), the snapshot `get` calls (exactly 1), intake/details ids (no skipped id), the summary, and `load_end`;
  - a re-submitted `review` KP stays `pending/review` and is absent from the release call;
  - a new `not_in_qa` KP in round 2 is released;
  - a re-submitted KP returned as an output → `pending`, no KP group, the round-1 row still `knowledge_product`; a re-submitted output returned as a KP and classified `auto_validated` → released (S-9 b, c; amended 2026-11-09); the type-changed result lists `["result_type_key"]` and adds no snapshot `get` (FR-8, amended 2026-11-09);
  - a missing previous snapshot → the lot fails `INTERNAL`;
  - **P-8:** run the re-entry case with `process.env.TZ` set to a non-UTC zone (`America/Bogota`) in the test, and assert the same verdict.

  The log spy asserts no title or field key in any line.
- **Verification:** `V-unit src/ingestion/load-runner.spec.ts`; `V-all`; `V-static`.
- **Falsifier:**
  - Compare with `previous.snapshotHash` skipped: the same-hash case reads DynamoDB, and the "exactly 1 get" assertion goes red.
  - Classify re-submitted results: the `review` KP case goes red.
  - Count `returnedNotResubmitted` from lots: the unlisted case goes red.
- **Red run:** predicted — greenfield artifact (observed in T-6). The new flows do not exist; quote the reds of the new cases before the runner edit.
- **Disqualifier:**
  - A fixture where the previous and new values are equal for every result, so `changedFields` is never exercised with a difference.
  - A TZ test that sets `TZ` after the date objects are built.
- **Consumers:** `load-runner.spec.ts`; `test/support/ingestion-app.ts`; `test/ingestion-loads.e2e-spec.ts` (P-12).
- **Review:** full — the run's core path and the KP release interaction.
- **Done when:** every listed case passes, step-1 runner cases are green unchanged except those naming `loadWindow`, and the S-9 gate is recorded.
- **Amended 2026-11-09 (Leader, at the T-6 Reviewer's request; no requirement's meaning changed):** step-1 pins changed because FR-11 / § 5.5 and § 7.7 change the shape they pin — `load-runner.spec.ts` ×3 (the `load_end` pin in the `REPORTING_UNAVAILABLE` case; two `failed` log lines gain `"round":1`) and `loads.unit-of-work.spec.ts` ×6 `load_end` pins (stale-abandon, completed, failed, `load_end names its load`, the legacy-summary case, retitled since `load_end` now adds keys).
- **Skills:** nestjs-expert, tdd

## T-7: Service, models, controller docs and e2e

- **Status:** [x]
- **Size:** M
- **Depends on:** T-6
- **Requirements:**
  - FR-1 (preview `window`; Sync in step 4; Last closing minute; Before step 1 opens; Closed cycle, end to end);
  - FR-9 (preview counts);
  - FR-10 (list, detail, progress fields; old loads);
  - FR-12 (ADMIN only, idempotent start, privacy suite unchanged);
  - FR-3 (end to end: 400 `ROUND_ABOVE_MAX` on create; an edit sending `round` → 400 `UNKNOWN_FIELD`, amended 2026-11-06);
  - FR-6 (BUT not reachable over HTTP: the route inventory is unchanged).
- **Design refs:** § 6, § 7.1 (preview), § 7.7
- **Scope:**
  - `loads.service.ts` (preview: `syncWindow`, round, position, `toLoad.new/resubmitted`, `returnedNotResubmitted`, the new skip);
  - `models/load.model.ts`, DTOs, and the Swagger text on `loads.controller.ts`;
  - `test/ingestion-loads.e2e-spec.ts` (window cases rewritten: step 4 open, last minute, +1 minute; round in list/detail; a round-2 sync re-admitting a result returned through the store);
  - `test/ingestion-loads-privacy.e2e-spec.ts` (new fields carry no PII);
  - the timeline e2e for `ROUND_ABOVE_MAX` on create, and `round` on edit → `UNKNOWN_FIELD`.
- **Tests:** as in scope, plus `loads.service.spec.ts` for the preview counts.
- **Verification:** `V-unit src/ingestion/loads.service.spec.ts`; `V-all`; `V-e2e`; `V-static`.
- **Falsifier:**
  - Keep `stepOne.closesAt` in the preview's window: the e2e "step 4 open → `window: 'open'`" goes red.
  - Omit `round` from the list model: the OpenAPI snapshot / e2e field check goes red.
- **Red run:** observed in T-7. The rewritten window e2e cases run red against T-6's tree before the service edit; quote them.
- **Disqualifier:**
  - The window and round e2e cases bypass the HTTP routes (call the service or store directly). They run through the real app over the in-memory stores; MySQL is checked live in T-9 (amended 2026-11-06, back lead).
  - The route inventory test was updated to admit a new route.
- **Consumers:** `test/ingestion-loads.e2e-spec.ts`, `test/ingestion-loads-privacy.e2e-spec.ts`, `test/auth-hardening.e2e-spec.ts` (route inventory, must not change), `loads.service.spec.ts`. Client consumers in P-12 go to T-8.
- **Review:** full — the public contract.
- **Done when:** all suites are green and the route inventory is unchanged.
- **Skills:** nestjs-expert, api-design-principles

## T-8: Documents

- **Status:** [x]
- **Size:** S
- **Depends on:** T-7. The AC text waits for the BA gate.
- **Requirements:** FR-13 (all three bullets); P-13 settled
- **Design refs:** § 8, § 9
- **Scope:**
  - New `docs/specs/ingestion/timeline-sync/front-contract.md`. It supersedes the step-1 copy, which is left untouched in the archive. It covers:
    - the window and round rules;
    - every new field and summary key;
    - `RETURNED_NOT_RESUBMITTED`, `returned`, `ROUND_ABOVE_MAX`;
    - stored-but-not-exposed changed fields;
    - the clock-skew note;
    - the list of client files to follow (P-12).
  - **First step:** read `client/src/app/pages/workspace/cycle/cycle.logic.ts` and state in the contract whether it gates the load action on step 1 (P-13).
  - `server/src/ingestion/AGENTS.md`: model line, rules (window, round, membership per round, return, re-entry), and files; point to this spec as current.
  - `server/src/database/AGENTS.md`: `0008`.
  - `docs/prd.md:10` and `:62`: ingestion is a manual ADMIN sync at any step.
- **Tests:** none (documents).
- **Verification:** a manual check:
  - every code in `error-codes.ts` and every `SkipReason` / summary key in `load-rules.ts` appears in `front-contract.md` (`git grep` each name, quoted in `execution.md`);
  - `git grep -n -i "automatic ingestion" docs/prd.md` → 0 hits.
- **Falsifier:** remove `RETURNED_NOT_RESUBMITTED` from the contract. The per-name grep check reports it missing.
- **Red run:** n/a (no test gate)
- **Disqualifier:** a grep over the contract using a pattern that also matches the step-1 archive copy.
- **Consumers:** none (no shared symbol changed)
- **Review:** checklist — documents against the code.
- **Done when:** every name is found, P-13 is recorded, and the PRD has no "automatic" claim.
- **Skills:** cognitive-doc-design

## T-9: HITL on qatest (after a human deploy)

- **Status:** [x]
- **Size:** S
- **Depends on:** T-8, and a deploy by the team (agents never deploy)
- **Requirements:** FR-1, FR-2, FR-10 live; P-7 and P-8 settled
- **Design refs:** § 11 (P-7, P-8)
- **Scope:** an ADMIN, with the token from a file outside the repo and never pasted in chat (KZ-admin-config--cycle-timelines-3):
  1. Sync timeline 29 (cycle 34) in its current step. Check that the round and position match the step in force.
  2. Read the list and detail.
  3. Confirm the start is refused one minute after the last step closes, on a test timeline whose dates allow it.
  4. Before step 1: the team (human step) runs `pnpm db:migrate` so `0008` applies on top of `0007` on `qadb`. Record the outcome; it is the only proof that the migration applies on MySQL (amended 2026-11-06).

  Infrastructure (Cris) confirms the `TZ` of every QA server process (P-8). The team runs the P-7 query on PROD before its deploy.

  A live round-2 **re-entry** cannot be exercised yet: no route returns a result, and hand-run SQL writes on shared databases are forbidden. Record it as covered by T-6 and T-7 only, until the assessment spec ships.
- **Tests:** none (live check).
- **Verification:** the observed responses, recorded in `execution.md`.
- **Falsifier:** n/a (live observation)
- **Red run:** n/a (no test gate)
- **Disqualifier:**
  - The check ran against a local server instead of qatest.
  - The token was pasted in chat.
- **Consumers:** none (no shared symbol changed)
- **Review:** checklist — evidence record.
- **Done when:** the migration outcome and the three observations are recorded, and P-7 and P-8 carry an answer or a named owner.
- **Skills:** none
