# A stale edit can answer 200 as a no-op — Tasks

| | |
|---|---|
| Spec path | `docs/specs/bugfix/timeline-edit-noop-stale` |
| Depth | Lite, Bug Mode |
| Branch | `fix/timeline-edit-noop-stale` (from `origin/feat/timeline-edit` @ `d7c2f36`) |
| PRs | One PR (T-1). T-2 is a human step, recorded in `execution.md` |
| Budget | `design.md` § 10: 2 tasks · ~25 LOC `src` + ~120 LOC tests · 1 review round |

## Dependency graph

```text
T-1 ─▶ T-2 (HITL)
```

## T-1: Confirm the version before every unlocked answer, with regression tests

- **Status:** [x]
- **Size:** S
- **Depends on:** none
- **Requirements:**
  - FR-1: Scenario *Identical edit committed during the read* (THEN 409; BUT not 200; BUT no second audit record), Scenario *Stale edit that would be a 400* (THEN 409; BUT nothing written), Scenario *Stale edit that would ask for confirmation*.
  - FR-2: Scenario *Real no-op* (BUT not 409), Scenario *Current-version refusals and writes*.
  - NFR-1.
- **Design refs:** design.md § 3, § 7, DD-1, DD-2; Premise Ledger P-1…P-7
- **Scope:**
  - **First step (settles P-7):** run the full `pnpm test` on the unchanged code and record any test that pins an absolute statement count on an edit's 400 or 409 unconfirmed.
  - `server/src/admin-config/timelines/timelines.service.ts` (`update` steps 5, 6, 7 only).
  - `server/src/admin-config/timelines/timelines.service.spec.ts` (new tests in the `update` describe).
  - Not touched: the store, the unit of work, the controller, the DTOs, the in-memory fake, the e2e suite, `client/`.
- **Tests:** in the `update: the edit flow` describe, a helper that builds a `TimelinesService` over a store whose `findBundle` reads the row, then runs a rival edit through `w.instance()`, then reads steps and scope (DD-2). Four tests:
  1. **No-op on a mixed read:** the rival and the request both send `{ version: 1, steps: [{ position: 3, closesOn: '2026-11-27' }] }`. Expect `TimelineVersionStaleError`. Also assert one version bump (version 2) and exactly one audit row, from the rival.
  2. **400 on a mixed read:** the rival sends `{ version: 1, steps: [{ position: 3, opensOn: '2026-11-18' }] }`, the request sends `{ version: 1, steps: [{ position: 3, closesOn: '2026-11-17' }] }`. Expect `TimelineVersionStaleError`, nothing written by the request.
  3. **Unconfirmed on a mixed read:** a request that touches a step in progress only in the rival's committed state, without `confirmInProgress`. Expect `TimelineVersionStaleError`. The Implementer derives the fixture with `startStepTwo` and records it.
  4. **A real no-op still answers 200 with the same version:** the existing `:2811` test, kept unchanged and green.
  - FR-2 *Current-version refusals and writes* is owned by the existing `update` describe (the 400, 409 unconfirmed and applied-edit tests) and the e2e FR-10 / FR-11 block, which stay green unchanged.
  - NFR-1: the write path's statement-count tests (`:3249`, `timelines.unit-of-work.spec.ts:830`) stay green unchanged. The +1 statement on a 400 or 409 unconfirmed is accepted by design (DD-1), not asserted.
- **Verification:** `cd server && pnpm lint && pnpm build && pnpm test --reporter=dot && pnpm test:e2e --reporter=dot`
- **Falsifier:** remove the version confirmation from any one of the three exits. The matching test goes red on its assertion, and the other two stay green. Run this against the post-change code, once per exit.
- **Red run:** observed at baseline `d7c2f36` (scratch worktree, 2026-10-22), tests 1 and 2:
  - `× no-op on a mixed read` → `AssertionError: promise resolved "{ id: 1, cycleId: 1, …(14) }" instead of rejecting`.
  - `× 400 on a mixed read` → `AssertionError: expected TimelineValidationError: Some fields are … to be an instance of TimelineVersionStaleError`.
  - Test 3's red is observed by the Implementer before the fix and quoted in `execution.md`.
- **Disqualifier:**
  - A red from setup, an unresolved import or a timeout, rather than the stale assertion.
  - A fake store whose rival never commits, which you can see because the version stays 1 after the rival.
  - Any change to the in-memory fake's own `findBundle`, which would make the fix pass on a fixture that does not model the adapter's statement order.
- **Consumers:** `timelines.service.spec.ts` (`:2811` no-op, `:2842` stale no-op, `:1443` / `:1477` / `:3249` statement counts) and `server/test/admin-config-timelines.e2e-spec.ts` (`:2536` FR-10 / FR-11 block). Grep as run in design.md P-6. They must stay green unchanged, unless T-1's first step recorded a pin and the reason. Design-time reader (P-5): the front `updateTimeline` (`9e5fcb4`, `staging-center`) already handles `TIMELINES_VERSION_STALE`, so it needs no change.
- **Review:** full. It changes delivered API answers on a concurrency path where fakes have hidden defects before (KZ-admin-config--cycle-timelines-1).
- **Done when:**
  - P-7 is settled and recorded.
  - Tests 1–3 were red on the assertion before the fix and are green after.
  - The falsifier was run on each exit.
  - The verification command is green, with the counts recorded.
  - The commit is `[SPEC:bugfix/timeline-edit-noop-stale] 🐛 fix(cycle) P2-3936: answer stale when the version moved before an unlocked edit answer`.
- **Skills:** nestjs-expert, systematic-debugging, tdd

## T-2: HITL on TEST — five same-version edits give one 200

- **Status:** [x]
- **Size:** S
- **Depends on:** T-1, deployed to TEST
- **Requirements:** NFR-2. FR-1 Scenario *Identical edit committed during the read* (AND IT MUST hold when both requests arrive at the same moment).
- **Design refs:** design.md DD-3
- **Scope:**
  - A human step by the back lead. The agent prepares the script and reads only its output.
  - The token stays in the back lead's shell variable and never reaches the chat or a file in the repo (KZ-admin-config--cycle-timelines-3).
  - Reuse disposable timeline 22 in `draft` cycle 33 (2076). Read its current `version` first.
- **Tests:** n/a (manual).
- **Verification:** at least 5 rounds of 5 overlapping `PATCH /timelines/22`, each round with the same `version` and the same body, and every request's status, code, request id and timestamps logged. Every round gives exactly one 200 and four 409 `TIMELINES_VERSION_STALE`. Then `SELECT COUNT(*) FROM timeline_audit_events WHERE timeline_id = 22` rises by the number of rounds (from 9).
- **Falsifier:** sending the 5 requests one after another gives one 200 and four 409s trivially. The round counts only if the send/receive windows overlap, so record the timestamps.
- **Red run:** n/a (no test gate). The pre-fix run on 2026-10-22 gave 2 × 200 in round `version 6` (`proposal.md` § Reproduction Steps).
- **Disqualifier:**
  - Requests that did not overlap.
  - Rounds whose bodies differ: that path was already correct, so the round is not evidence.
  - A token that passed through chat.
  - TEST running a build without T-1.
- **Consumers:** none (no shared symbol changed)
- **Review:** checklist. The Leader checks the recorded evidence.
- **Done when:** the counts are recorded in `execution.md` with request ids, and the parent *edit* T-9 can cite this run for P-12.
- **Skills:** none
