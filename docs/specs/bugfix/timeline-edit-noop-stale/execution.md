# A stale edit can answer 200 as a no-op — Execution

## Document Control

| | |
|---|---|
| Spec path | `docs/specs/bugfix/timeline-edit-noop-stale` |
| Approval Mode | gated |
| Branch | `fix/timeline-edit-noop-stale` (from `d7c2f36`) |
| Started | 2026-10-22 |
| Approval | The back lead (Juanda) ran `/akili-execute bugfix/timeline-edit-noop-stale` on 2026-10-22. That run is the approval of the Draft spec (proposal Q-1…Q-3 defaults kept) |
| Leader | Claude Code, `opus` (T1) |
| Status | T-1 done · T-2 pending (HITL, needs T-1 deployed to TEST) |

## Task Execution History

### T-1: Confirm the version before every unlocked answer, with regression tests

- **Final status:** PASS (attempt 1)
- **Date:** 2026-10-22
- **Attempts:** 1
- **Skills:** nestjs-expert, tdd. Deviation: `systematic-debugging` dropped, because the proposal already confirms the root cause (§ Root Cause) and the task is a guarded fix plus tests, not an investigation.
- **Effort:** xhigh (concurrency correctness on a delivered API answer). Implementer on the T2 wrapper.

#### Attempt 1

- **Files changed:**
  - `server/src/admin-config/timelines/timelines.service.ts` (+40/-2): a new private `confirmVersion(timelineId, version)` does a pool `findById`. A missing row throws `TimelineNotFoundError`, a different version throws `TimelineVersionStaleError`. It runs just before the step-5 400 and the step-6 409 unconfirmed. On the step-7 no-op, the service compares the version that `read()` returns and throws stale on a mismatch. This adds no statement.
  - `server/src/admin-config/timelines/timelines.service.spec.ts` (+139/-0): a `mixedRead(w, rival)` helper plus the describe `a stale edit on a mixed read` with 3 tests. No existing test was edited.
- **P-7 (settled):**
  - Baseline `pnpm test` at `d7c2f36`: 51 files, 1962 tests, all green.
  - No test pins an absolute statement count on an edit's 400 or 409 unconfirmed. Checked: service.spec `:1443`, `:1477` (GET reads) and `:3249` (successful edit, write path); unit-of-work.spec `:811`, `:830`, `:1213` (store and UoW, not the service); e2e `:1380` (GET reads), whose `timelineWriteLog` asserts writes only.
  - No pin was updated.
- **Mixed-read helper (DD-2):**
  - The test service runs over `Object.assign(Object.create(w.db.timelineStore), { findBundle })`, so the fake's own `findBundle` is untouched.
  - The override follows the adapter's order. It reads the row with `findById`, then commits the rival via `w.instance().update(w.ctx(8), …)`, then reads `listSteps`, `listPrograms` and `listResultTypes`.
  - Each test asserts that the rival committed: version 2, one audit row (actor 8). It also asserts that the request wrote nothing and `begun` is 0.
- **Test 3 fixture (derived, as the task asks):**
  - `startStepTwo(w, id); w.clock.advance(4 * DAY)`, so today is 2026-11-14. Steps 1 and 2 are closed, step 3 (opens 2026-11-16) is upcoming, and a load is marked.
  - Rival: `{ version: 1, steps: [{ position: 3, opensOn: '2026-11-14' }] }`, so step 3 is in progress only in the rival's state.
  - Request: `{ version: 1, steps: [{ position: 3, closesOn: '2026-11-21' }] }`, without `confirmInProgress`.
  - Why +4 days: at `startStepTwo`'s date (2026-11-10), step 3 cannot open on or before today without overlapping step 2.
- **Red run before the fix:** `pnpm exec vitest run src/admin-config/timelines/timelines.service.spec.ts -t "mixed read"` → `Tests 3 failed | 207 skipped (210)`, all three on the stale assertion:
  ```
  × no-op on a mixed read … → AssertionError: promise resolved "{ id: 1, cycleId: 1, …(14) }" instead of rejecting
  × 400 on a mixed read … → AssertionError: expected TimelineValidationError: Some fields are … { …(5) } to be an instance of TimelineVersionStaleError
  × unconfirmed on a mixed read … → AssertionError: expected TimelineInProgressUnconfirmedError: This … { …(4) } to be an instance of TimelineVersionStaleError
  ```
  After the fix: `3 passed | 207 skipped (210)`.
- **Falsifier (post-change code, one exit at a time, file restored and checked with `cmp`):**
  - Step 5 removed: only `400 on a mixed read` is red (`expected TimelineValidationError … to be an instance of TimelineVersionStaleError`); the other 2 pass.
  - Step 6 removed: only `unconfirmed on a mixed read` is red (`expected TimelineInProgressUnconfirmedError … to be an instance of TimelineVersionStaleError`); the other 2 pass.
  - Step 7 removed: only `no-op on a mixed read` is red (`promise resolved … instead of rejecting`); the other 2 pass.
- **Implementer verification:** `cd server && pnpm lint && pnpm build && pnpm test --reporter=dot && pnpm test:e2e --reporter=dot` → exit 0. Lint 0 warnings, build OK, unit 51 files / 1965 tests, e2e 13 files / 779 tests.
- **Evidence re-run (Leader-inline, non-author):** same command → exit 0, unit `Tests 1965 passed (1965)`, e2e `Tests 779 passed (779)`. **VERIFIED.**
- **Reviewer verdict:** PASS. "The diff does what T-1 asks. Steps 5 and 6 each confirm the version with one pool `findById`, using the private `confirmVersion` described in design § 7. Step 7 compares the version returned by `read()` and adds no statement. That matches DD-1 and design § 3. Tests 1–3 use a DD-2 mixed-read store and leave the fake's own `findBundle` untouched. The red runs fail on the stale assertion, and the falsifier was run once per exit." Lens mode: checklist.
- **runtime events:** none
- **spawns:** implementer 54 calls, 194737 tokens, ended partial (Not Done / Assumptions with no owed item, see below); reviewer not reported by host, ended complete.

#### Not Done / Assumptions (Implementer, verbatim summary)

- **Environment repair (not a repo change):** `server/node_modules` was hollow: only a `.pnpm` skeleton, so `vitest: command not found`. The Implementer ran `pnpm install --frozen-lockfile --offline` from the local store. The lockfile is unchanged and `node_modules` is git-ignored. `server/dist` came from `pnpm build` and is git-ignored too.
- **Budget:** src +40/-2 vs ~25 (about 14 lines of code, the rest `@akili-spec` comments); tests +139 vs ~120. Not trimmed.
- **Untested path:** the 404 branch of `confirmVersion` (row gone between the reads) has no test. The task does not specify one.
- **Statement counts:** the +1 statement on a 400 or 409 unconfirmed is accepted by DD-1 and not asserted.
- **Docs:** the "Edit flow" paragraph in `server/src/admin-config/AGENTS.md` could add that the 400, the 409 unconfirmed and the no-op also confirm the version. Not edited, under the shared-file discipline.

Classification: no named blocker and no owed item (each point is an assumption, a note or outside the task). No continuation fired.

#### ADVISORY (Reviewer, 4R; never gates)

- READABILITY: Three `@akili-spec` comment blocks partly repeat the `confirmVersion` JSDoc. The step-5/6 blocks could be one-line pointers.
- READABILITY: "(step 3 passed)" in the step-5 comment would read better as "(the early stale check passed)".
- RELIABILITY: The 404 branch of `confirmVersion` is untested. It is cheap to add with `mixedRead` and a rival that deletes the row.
- RELIABILITY: Test 3 depends on the rule that "an upcoming step may open today". If that rule changes, the test breaks at setup. The `version: 2` check still catches it, so the risk is low.
- RESILIENCE: A window remains after the confirmation read and before the answer. An edit that commits there is accepted as correct "as of the confirmation read". DD-1 accepts this: the window cannot be closed on the pool.
- RISK: Low. Only the answers a stale request gets change, and the front already handles `TIMELINES_VERSION_STALE` (P-5). InnoDB timing is covered only by T-2.

#### Requirements covered

FR-1 (reproduction, would be 400, would ask for confirmation, at unit level; "same moment" is owed by T-2), FR-2 (real no-op, current-version answers), NFR-1.

#### Decisions made

- The Reviewer brief pointed to a scratchpad file with the diff (230 lines) instead of inlining it. The command keeps diffs of 300 lines or fewer inline, so this is a deviation. It was chosen for economy and the Reviewer read the whole file.
- No execute-time edits to the spec.

#### Issues encountered

- **Budget tripwire:** src LOC is +40 against ~25 (design § 10), and tests are +139 against ~120. Tasks (1 of 2) and review rounds (1 of 1) are within budget. Escalated to the back lead at the T-1 gate. The back lead answered "Sigue" (2026-10-22), which accepts the overrun and continues to T-2.

#### Final verification

`cd server && pnpm lint && pnpm build && pnpm test --reporter=dot && pnpm test:e2e --reporter=dot` → green (1965 unit, 779 e2e). Leader VERIFIED.

### T-2: HITL on TEST — five same-version edits give one 200

- **Status:** in progress (evidence recorded; the post-run audit count and the confirmation that TEST runs `b609fae` are still owed)
- **Date:** 2026-10-22
- **Run by:** the back lead, in his own terminal. The token was read from the clipboard (`QA_TOKEN="$(pbpaste)"`) and never passed through chat. Script: the session scratchpad `t2-hitl.mjs` (5 rounds, timeline 22, step 5 `closesOn` toggled 2026-12-26 ↔ 2026-12-27 so that every round is a real change).
- **Baseline:** `SELECT COUNT(*) FROM timeline_audit_events WHERE timeline_id = 22` → 9 (before the run). Start version 10, which is consistent with 9 applied edits from version 1.
- **Result:** 5/5 rounds OK. The end version is 15 (start 10, +5).

| Round | Version | 200 request id | Sends within | Overlap |
|---|---|---|---|---|
| 1 | 10 → 11 | `0840c03f-4bce-4280-a381-8fa10df06932` | 2.0 ms | yes |
| 2 | 11 → 12 | `ba2140a0-d3ef-4216-bf8b-381c4fd370fa` | 5.0 ms | yes |
| 3 | 12 → 13 | `0f46605a-9e43-4201-b61d-ce66116d73ef` | 1.0 ms | yes |
| 4 | 13 → 14 | `b8bdfe3f-6bbd-4720-bf12-b70dbab299e2` | 1.0 ms | yes |
| 5 | 14 → 15 | `8e7898f5-da20-4cdc-ada0-98ba5b8a69d5` | 1.0 ms | yes |

Each round gave the other four answers as 409 `TIMELINES_VERSION_STALE`. Round 1's stale ids: `36d1409b…`, `6a42792e…`, `407aec99…`, `56cd52cd…`. In every round, the last send came before the first receive (sent 1792680480.226 – 1792680481.212).
- **Post-run audit count:** `SELECT COUNT(*) FROM timeline_audit_events WHERE timeline_id = 22` → 14 (9 + 5). That is one audit row per applied edit and no extra row.
- **Disqualifier check (TEST running a build without T-1): not cleared.** `git fetch origin && git branch -r --contains b609fae` returns no remote branch (2026-10-22), so the fix has not been pushed anywhere CI could deploy from. Before the fix the bug showed in 1 of 4 logged rounds, so 5 clean rounds on the old build happen about 24 % of the time ((3/4)^5). This run is therefore recorded as **not yet evidence for NFR-2**, unless the back lead confirms that TEST was deployed from this local commit. Otherwise, re-run after the fix is pushed and deployed.
