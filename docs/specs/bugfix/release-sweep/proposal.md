# Proposal: release sweep (P2-3910 bug)

| Field | Value |
|---|---|
| Type | Bug |
| Deliverable | software |
| Spec Path | bugfix/release-sweep |
| Parent | assessment/step-1-assessment (P2-3910, FR-18) |
| Approval | back lead, 2026-11-20 (design approved; admin retry skips the backoff) |
| Branch | fix/P2-3910-release-sweep from origin/staging-center |


**Type:** Bug · **Parent:** P2-3910 (release outbox, commit `e013845`, 2026-11-11) · **Found in:** P2-3912 HITL on qatest, 2026-11-20

## Symptom

QA ends a result (round 1 `returned` → `not_qaed`, or `quality_assessed` → `qaed`) and queues a release row. Reporting never gets it, so it keeps the result locked (`in_qa = 1`): the program cannot unsubmit or resubmit it ("This result is under QA review and cannot be unsubmitted until QA releases it").

## Reproduction (qatest, 2026-11-20)

1. Timeline 40, results 10152 and 10153 finished as Returned about 0.5 s apart (13:01 UTC).
2. 10152's release was acknowledged; 10153's stayed `pending` with `attempts = 1`, `reason = null`.
3. One hour later it was still `pending`; Reporting refused the unsubmit of 10153 with 409.
4. `POST /assessment-releases/retry` (admin): `attempted 1, sent 1` → Reporting unlocked 10153.

## Root cause

The outbox is only dispatched (a) right after an end commits, fire-and-forget, and (b) by the admin retry. There is no periodic sweep. When the dispatch in (a) fails (send failed, unanswered row, ack rolled back, or the claim found the row still leased by a parallel dispatch), the row waits for the next end anywhere in QA or for an admin. With neither, it waits forever. Why 10153's first dispatch failed is not known (no access to the qatest logs); the missing sweep is what turns any transient failure into a permanent lock.

## Expected

A pending release reaches Reporting without anyone acting, within minutes, while Reporting is up.

## Impact

- The program cannot edit/resubmit the result → the round-2 load never sees it.
- Silent: QA shows "Returned to program" (or Quality Assessed) while Reporting shows "under QA review".

## Acceptance criteria

1. A `pending` release whose dispatch failed is sent by the next sweep, with no end and no admin action.
2. Retries back off: 1 min, 2, 4, 8, 16, then every 30 min; never two sends of one row at once.
3. Finish/validate/decide latency does not change (the sweep never runs inside a request).
4. Two API instances sweeping at the same time never send the same row twice (lease).
5. A row still pending after 10 attempts logs `release_stuck` (warn) once per sweep, for an alert; it stays `pending` (only Reporting can `refuse`).
6. Admin list/retry unchanged.
