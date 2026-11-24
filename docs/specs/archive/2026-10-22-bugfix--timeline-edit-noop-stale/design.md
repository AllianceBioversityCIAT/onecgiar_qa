# A stale edit can answer 200 as a no-op — Design

## 1. Document Control

| | |
|---|---|
| Spec path | `docs/specs/bugfix/timeline-edit-noop-stale` |
| Requirements | `requirements.md` (FR-1, FR-2, NFR-1, NFR-2) |
| Depth | Lite, Bug Mode |
| Status | Draft |
| Builds on | `docs/specs/admin-config/timeline-edit/design.md` (cited as *edit*): DD-6, § 7.2 |
| Last updated | 2026-10-22 |

## 2. Executive Summary

Before the edit gives any answer without writing (the 400, the 409 unconfirmed, the no-op 200), it confirms that the row's version is still the one the request named. If the version moved, the answer is 409 `TIMELINES_VERSION_STALE`.

This works because every applied edit raises the version in the same transaction as its step and scope changes. An unchanged version on the second read therefore proves that no edit committed between the two reads, so the bundle the request judged was consistent. The write path keeps its locked re-check and does not change.

## 3. Architecture Overview

No new component. The change is inside `TimelinesService.update` (`server/src/admin-config/timelines/timelines.service.ts:423-580`) and follows *edit* § 7.2. Steps 1–3 stay as they are. Steps 5, 6 and 7 gain a version confirmation before they answer. Step 8 is unchanged.

| Step (*edit* § 7.2) | Today | After |
|---|---|---|
| 3. early stale check (`:452`) | against the first row read | unchanged |
| 5. 400 (`:494`) | answers from the bundle | confirms the version first (one `findById`), stale wins |
| 6. 409 unconfirmed (`:503`) | answers from the bundle | confirms the version first (one `findById`), stale wins |
| 7. no-op (`:508-510`) | returns `read()` as it is now | compares the version `read()` returns with the request's; stale if it moved (no extra statement) |
| 8. write (`:513-`) | locked re-check `:517` | unchanged |

## 4. Extended Directory Structure

```text
server/src/admin-config/timelines/
├── timelines.service.ts        # changed: version confirmation before steps 5, 6, 7
└── timelines.service.spec.ts   # changed: regression tests with a mixed-read store
```

## 5. Data Model

No change.

## 6. API Design

| Method | Path | Roles | Request | Response | Errors |
|---|---|---|---|---|---|
| `PATCH` | `/api/v1/timelines/:id` | ADMIN | unchanged | unchanged | unchanged set. A stale edit now gets 409 `TIMELINES_VERSION_STALE` in the three cases of FR-1 |

The OpenAPI text (`timelines.controller.ts:182`) already says "otherwise 409 `TIMELINES_VERSION_STALE` and nothing is written". No edit is needed.

## 7. Backend Module Design

- **Version confirmation:** one private step of the service. It reads the row with the existing pool `findById`. If the row is gone, it answers `TimelineNotFoundError`; if the version differs, it throws `TimelineVersionStaleError`. It runs only on an unlocked answer, so it is never inside a transaction.
- **No-op:** the answer already re-reads the row (`read` → `findById`, `:231-236`). Its version is the confirmation: a mismatch throws stale instead of returning the response.
- **Logging:** unchanged. `logged()` already records a stale refusal as `outcome: refused, reason: TIMELINES_VERSION_STALE` (seen on TEST).
- **Idempotency:** a 409 stale is a 4xx, stored and replayed like any refusal (*edit* front contract § 8). The client reloads on it, as today.

## 8. Frontend / UX Component Architecture

No change. `updateTimeline` (`9e5fcb4`) already handles `TIMELINES_VERSION_STALE`.

## 9. Shared Contracts or Package Extensions

None.

## 10. Design Decisions

| ID | Decision | Alternatives rejected | Consequence | Requirements |
|---|---|---|---|---|
| DD-1 | Confirm the version with one more row read before each unlocked answer. On the no-op, reuse the answer's own read | B: read the bundle in one `REPEATABLE READ` snapshot. It goes against the module's READ COMMITTED choice (`timelines.unit-of-work.ts:101-104`) and changes `findBundle`'s pool contract and its test (`timelines.unit-of-work.spec.ts:811-823`). C: decide the no-op under the lock. Every no-op would open a transaction and the 400 / unconfirmed siblings would stay open | +1 statement on a 400 or a 409 unconfirmed, +0 on a no-op, +0 on a write | FR-1, FR-2, NFR-1 |
| DD-2 | The regression tests use the service's in-memory world with a store whose `findBundle` lets another edit commit between the row read and the steps read. This is a real mixed read, made deterministic | A timing-based concurrent test on the fake (the fake serializes, KZ-admin-config--cycle-timelines-1) | Red before the fix on the assertion (200 instead of 409), green after | FR-1 |
| DD-3 | MySQL proof by HITL re-run on TEST, with the token in the back lead's shell | Agent-held token (KZ-admin-config--cycle-timelines-3; disqualifier of *edit* T-9) | The agent sees only the results | NFR-2 |

**Reversion challenge (Step 2.3) — DD-1 changes a delivered answer (400 / 409 unconfirmed / 200 → 409 stale).** What does removing it break?

- A stale request with real rule problems no longer lists its field errors. This is intended: the contract orders stale before 400 ("Stale beats everything below it", front contract § 6), and after the reload the same values get their 400.
- A same-key retry now replays the stored 409 instead of a 200. The client reloads, which the contract already requires for stale.

Nothing else reads these answers. The design stands.

**Budget (tripwire):** 2 tasks (T-1 code + tests, T-2 HITL) · about 25 LOC in `src`, about 120 LOC of tests · 1 review round.

## 11. Premise Ledger

Count: 6 verified, 1 `UNVERIFIED` (Low: 1, High: 0).
Blast-radius triggers fired: `live-path` (names `PATCH /timelines/:id`), `shared-state` (changes what the edit's unlocked answers read), `consumer` (changes the response a stale request gets).

| # | Claim | Class | Citation (as run) | Verified at | If false | Settled by |
|---|---|---|---|---|---|---|
| P-1 | Every applied edit raises the version in the same transaction as its step and scope writes, so an unchanged version proves no edit committed in between | other | `timelines.service.ts:513-540` (`unitOfWork.run` holds `findForUpdate`, `updateTimeline`, steps, scope, audit); `timelines.store.ts:222` port: `UPDATE timelines SET version = version + 1 …` | `d7c2f36` | DD-1's proof fails; switch to option B (High) | — |
| P-2 | Nothing else writes the bundle's tables (`timelines` name/scope flags, `timeline_steps`, `timeline_programs`, `timeline_result_types`) after create without the edit's version bump | existence | `grep -nE "updateStep\|replacePrograms\|replaceResultTypes\|updateTimeline" server/src/admin-config/timelines/timelines.service.ts` → `:535, :546, :555, :564`, all inside `update`'s `unitOfWork.run`. `grep -rlE "timelineSteps\|timelinePrograms\|timelineResultTypes" server/src \| grep -v .spec.ts` → schema files, `timelines.store.ts`, and `cycles/cycles.store.ts`, which only reads (`min`/`max` join at `:128-133`). Assigns write `timeline_users` only (`:609`, `:695`) | `d7c2f36` | A non-versioned writer could still mix a read (High) | — |
| P-3 | The reproduction reaches the no-op exit | live-path | `PATCH /timelines/:id` → `TimelinesController.update` (`timelines.controller.ts:200-207`) → `TimelinesService.update` → `store.findBundle` (`:440`) → stale check (`:452`) → `diffTimeline` (`:458`) → no-op (`:508`) → `read` (`:509` → `:231`). TEST run 2026-10-22: 200 without a version bump | `d7c2f36` | Root cause not confirmed (High) | — |
| P-4 | The 400 and the 409 unconfirmed read the same mixed bundle | shared-state | `validateTimelineUpdate(stored, …)` at `:488-494`; `changesAnInProgressStep(stored, …)` at `:499-503`; `stored = storedTimeline(bundle)` at `:456`. No other version reader: `grep -rnE "VERSION_STALE\|version !==" server/src` → `timelines.service.ts:452,517` plus error and OpenAPI text | `d7c2f36` | Scope grows or shrinks (Low) | — |
| P-5 | The front client handles `TIMELINES_VERSION_STALE` already | consumer | `git show 9e5fcb4 --stat` + commit message: "the two new 409 codes and the LOCKED field code are listed" | `9e5fcb4` | A front change joins the scope (Low) | — |
| P-6 | Test consumers of the changed answers: `timelines.service.spec.ts` (no-op `:2811`, stale no-op `:2842`, statement counts `:1443`, `:1477`, `:3249`), `server/test/admin-config-timelines.e2e-spec.ts` (`:2536` FR-10/FR-11 block) | consumer | `grep -nE "no-op\|FR-11\|statement" server/src/admin-config/timelines/timelines.service.spec.ts server/test/admin-config-timelines.e2e-spec.ts` | `d7c2f36` | Missed pins break at T-1 (Low) | — |
| P-7 | No existing test pins an absolute statement count on a 400 or a 409 unconfirmed of the edit (`:3249` compares two step counts, so +1 on both sides cancels) | existence | `UNVERIFIED — confirm at source before relying on it` | — | Those pins get updated in T-1, with the reason recorded (Low) | T-1, first step: full `pnpm test` run before the fix |
