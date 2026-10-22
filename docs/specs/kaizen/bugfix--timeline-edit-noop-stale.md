# Kaizen Entry — bugfix/timeline-edit-noop-stale

## Document Control

| Field | Value |
|---|---|
| Spec Path | `bugfix/timeline-edit-noop-stale` |
| Date | 2026-10-22 |
| Branch | fix/timeline-edit-noop-stale |
| Archive Run | 1 |
| Approval Mode | gated |

## Metrics

| Signal | Value | Source |
|---|---|---|
| Tasks executed | 2 (T-1 code, T-2 HITL) | tasks.md |
| Reviewer FAIL rework attempts | 0 | execution.md |
| HALTs / FATAL_FAILs | 0 | execution.md |
| Pivots | 0 | execution.md |
| PRODUCT_BUGs | n/a (no test-report.md, absence accepted) | — |
| Judgment-day severe findings | none recorded | design.md |
| Validation FAIL / WARN | n/a (no validation-report.md, absence accepted) | — |
| Tasks closed under `REVIEW_WAIVED` (by flag) | 0 | execution.md |
| Tasks closed under `REVIEW_SKIPPED` (by task) | 0 | execution.md |
| Escaped defects (§3) | 0 | execution.md |
| Budget | 2/2 tasks, 1/1 review round; src LOC +40 vs ~25 (accepted) | execution.md — T-1 Issues encountered |

## Lessons

Clean run: no rework, pivot, HALT or waiver. No lesson is distilled.

## Noted, not a lesson

- **HITL run before the deploy.** T-2 run 1 ran against TEST before `b609fae` had been pushed. The Leader handed over the script without first checking `git branch -r --contains <fix>`, and caught the problem only afterwards, at the disqualifier check (execution.md — T-2, "Disqualifier check … not cleared"). It cost one wasted round on TEST, and a false pass would have been plausible: on the old build, 5 clean rounds happen about 24 % of the time. If this recurs, the lesson is to make the "deployed" check the first line of the HITL hand-over.
- **Token handover.** The back lead offered to paste the token in chat. The KZ-admin-config--cycle-timelines-3 handover (clipboard, `QA_TOKEN="$(pbpaste)"`) held, and no token reached the chat. This is not a recurrence of the failure, but the temptation recurs.
- **CI e2e timeout.** The NFR-5 e2e (`test/admin-config-timelines.e2e-spec.ts:1375`) timed out at 5 s in CI again; locally it takes about 2.5 s. This is the second time it is noted (the proposal's Q-1 mentions the earlier one).
- **Hollow `server/node_modules`.** The Implementer found `server/node_modules` hollow (`vitest: command not found`) and reinstalled offline. This is environment friction only.

## Pending Items

### P1

| Field | Value |
|---|---|
| Kind | guide-sync |
| Target | `server/src/admin-config/AGENTS.md` — "Edit flow" bullet, after "…no-op 200, then the write." |
| Edit | `The 400, the in-progress 409 and the no-op confirm the version before answering (one pool \`findById\`; the no-op checks its own answer's read), so a stale edit judged on a mixed \`findBundle\` read answers stale 409 (bugfix/timeline-edit-noop-stale DD-1).` |
| Severity | Low |
| Status | pending |
