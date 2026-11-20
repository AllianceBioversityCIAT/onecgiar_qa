# Design and requirements: release sweep

| Field | Value |
|---|---|
| Depth | Lite (Bug Mode) |
| Approved | back lead, 2026-11-20 |

## Requirements

- **R-1** A `pending` release whose dispatch failed SHALL be sent by a periodic sweep, with no end and no admin action (AC1).
- **R-2** Retries SHALL back off 1, 2, 4, 8, 16 min, then every 30 min; one row is never sent twice at once (AC2, AC4).
- **R-3** Finish / validate / decide SHALL NOT wait on the sweep (AC3).
- **R-4** `attempts >= 10` SHALL log `release_stuck` (ids and counts only); the row stays `pending` (AC5).
- **R-5** The admin retry SHALL send the pending rows immediately, except those the sweep already holds or will retry within ~90 s (so nothing is sent twice); the rest go out with the periodic sweep in ≤ ~3 min. No migration. List unchanged (AC6). (Amended by the back lead, 2026-11-20, after review: without a migration a backoff that ends within the in-flight tolerance cannot be told apart from a send in flight.)

### Scenario: regression (red before the fix)

- GIVEN a release row `pending` after a failed first dispatch, and no further end
- WHEN the sweep interval elapses
- THEN the row is sent and acknowledged

**Scope:** `server/src/assessment/release.service.ts`, `release.store.ts`, a new `release-sweeper.ts`, `assessment.module.ts`, config. **No migration, no API change, no front change.**

| # | Decision | Why |
|---|---|---|
| D1 | New provider `ReleaseSweeper` (`OnApplicationBootstrap` / `OnApplicationShutdown`): a self-rescheduling `setTimeout` (not `setInterval`) every `RELEASE_SWEEP_INTERVAL_MS` (default 60 s, ±20 % jitter, `unref()`), which calls the existing `dispatch()` | Reuses the leased claim, the send with retry and the ack; one sweep never overlaps the next; no new library (`@nestjs/schedule` is not installed) |
| D2 | Backoff stored in the existing `lease_until`: on a failed send, unanswered row or rolled-back ack, set `lease_until = now + min(60 s × 2^(attempts−1), 30 min)` for those rows (one conditional `UPDATE … WHERE status = 'pending'`) | The claim already skips rows whose lease is in the future, so the lease doubles as "next attempt at"; no new column |
| D3 | Idempotent by construction: a row is claimed under a lease (one sender at a time across instances); a re-send of an already released result answers `not_in_qa`, which already counts as `sent` | Unchanged contract from P2-3910 |
| D4 | The post-end dispatch and the admin retry stay as they are | Fast path stays fast; the sweep is only the safety net |
| D5 | `attempts ≥ 10` → one `release_stuck` warn log line per row per sweep (ids and counts only); the row stays `pending` | Alertable without inventing a terminal state; `refused` stays Reporting's word |
| D6 | `RELEASE_SWEEP_INTERVAL_MS=0` disables the sweeper (tests, local); config validated at startup | Unit/e2e keep their fake dispatcher and no timers |
| D7 | Sweep failures are caught and logged; the timer always re-arms; shutdown clears it and awaits an in-flight sweep | Never crashes the process, never blocks shutdown beyond one send (≤ worst-case send, < lease) |

## Round-1 impact (already delivered)

- Behaviour of finish/validate/decide: **none** (D4).
- Outbox rows: the same rows, sent sooner; a row that failed now waits its backoff instead of "until the next end". An admin retry sends immediately every pending row except those in flight or whose backoff ends within ~90 s (`RELEASE_LEASE_MS` + 30 s in-flight tolerance); those go out with the next sweep in ≤ ~3 min (R-5 as amended, back lead 2026-11-20). The deferred lease is fenced by the claim's `attempts`; the fence stops at the 255 cap (~5 days of 30-min backoffs, long after `release_stuck` started warning) — accepted by the back lead.

## Tests

- Unit: backoff table (attempts 1..12), lease set on each failure path, stuck log at 10, the sweeper re-arms after a throw and stops on shutdown (fake timers).
- e2e: a release whose first send fails is sent by the next sweep with no end; two sweepers in parallel send it once.
- Red first: e2e "pending row with no end and no retry is sent" fails today.

## Size

~250–350 LOC with tests; 1 implementer task + review.
