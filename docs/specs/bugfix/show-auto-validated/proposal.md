# Proposal: show Auto-validated results in Results (F-010)

| Field | Value |
|---|---|
| Type | Bug / change |
| Deliverable | software |
| Spec Path | bugfix/show-auto-validated |
| Amends | assessment/step-1-assessment FR-4 ("Auto-validated hidden by default") and FR-7 counters |
| Source | QA Platform Test Findings Log, F-010 (Mariagiulia Mariani, 2026-11-23); team note: "Back: include them in Results so the front shows Automatically validated" |
| Approval | back lead, 2026-11-24 |
| Branch | `fix/F-010-show-auto-validated` from `origin/staging-center` |

## Symptom

"I don't see Automatically validated KP under QA." Expected: "KP automatically validated clearly displayed."

## Root cause

Not a defect but a spec rule: FR-4 hid `auto_validated` memberships unless the status filter named them, and the counters followed. Back and front already render them (grey "Auto-validated" chip, read-only banner "this result is not assessed"). On qatest, timelines 27 and 34 hold 2 each; MG's timeline 43 holds no KP.

## Expected / acceptance criteria

1. With no status filter, the worklist lists Auto-validated memberships with the rest.
2. A status filter that does not name `auto_validated` leaves them out, like any status.
3. The counters ignore the filters: `total` includes them; a new additive `autoValidated` counts them; `pending` and `finished` never include them.
4. Additive contract change only (`counters.autoValidated`); no migration. The front needs no change to show them (it sends no status by default).
