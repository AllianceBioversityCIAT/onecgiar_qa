# Proposal: the QA Admin acts as any reviewer

| Field | Value |
|---|---|
| Spec Path | `admin/acts-as-reviewer` |
| Type | Change |
| Deliverable | software |
| Approval Mode | gated |
| Requirement source | Back lead decisions in chat, 2026-11-23 (no Jira story yet). Business confirmation by the QA business owner pending |
| Visual source | None: the front lead (Yeck) designs the role picker in the review page |
| Owners | Back: Juanda (`server/`). Front: Yeck (`client/`, review and results pages) |
| Branch | `feat/admin-acts-as-reviewer` from `origin/staging-center` (`006b350`) |
| Depends on | `assessment/step-1-assessment` (P2-3909, P2-3910), `escalation/round-2` (P2-3912). TPB and PPU parts land with P2-3916 / P2-3917 |

## 1. Intent

The QA Admin is transversal: they can work on any result **as** an Assessor, Lead Assessor, Third-Party Broker or PPU, picking the role, at any moment, and finish the review. Reviewers and admins see that the Admin wrote it; the program never does.

## 2. Problem / Current behavior

| Today | Evidence |
|---|---|
| The Admin reads every result and writes nothing (DD-2) | `server/src/assessment/role-steps.ts:25`; `docs/specs/assessment/step-1-assessment/design.md:295` (DD-2) |
| An Admin writes only when they also hold an active reviewer grant **and** a timeline assignment; they then write as that reviewer, inside the step window | `docs/specs/assessment/step-1-assessment/requirements.md:119` (FR-2) |
| A write by an Admin with no reviewer row is 403 `ASSESSMENT_READ_ONLY` | `server/src/assessment/assessment.service.ts:1949` |
| In round 2 the Admin's view has `role: null` and `choices: []` | `server/src/assessment/assessment-view.ts:316`; `docs/specs/escalation/round-2/front-contract.md:62` |
| Quick comments refuse an Admin without the role grant (403) | `server/src/assessment/quick-comments.service.ts:128` |
| One user cannot be Assessor and Lead Assessor on the same result type (409 `USERS_ROLE_CONFLICT`) | `server/src/users/role-assignments.repository.ts:114-145` |
| The program view carries no reviewer identity at all | `server/src/assessment/sp-view/sp-thread.ts:2` |
| Assessments are one per membership and step, with a `role_code`; decisions are one per comment and role | `server/src/database/drizzle/schema/result-assessments.ts:31,47`; `schema/comment-decisions.ts:32,50` |
| TPB and PPU rows exist but are disabled | `server/src/assessment/role-steps.ts` (rows TPB, PPU: `enabled: false`) |

No Jira story asks for Admin writes: P2-3909 AC4 only says the Admin sees all results.

## 3. Proposed outcome

| # | Rule (back lead, 2026-11-23) |
|---|---|
| R1 | The Admin picks the role they act as: Assessor, Lead Assessor, TPB or PPU. Each action follows that role's rules (fields, decisions, end rules) |
| R2 | The step dates do not bind the Admin: they write before the step opens and after it closes |
| R3 | The Admin can finish the review as that role; the end and its Reporting release run as for the reviewer |
| R4 | Reviewers and admins see the Admin as the author (for example "Admin · nickname"); the program sees no identity, as today |
| R5 | The Assessor / Lead conflict rule does not apply to the Admin |
| R6 (recommended) | The Admin skips the dates, not the flow: the role must match the result's round and state (no Lead decision on a round-1 result, no PPU action without a PPU case). Otherwise states break and releases duplicate |
| R7 (recommended) | Admin and reviewer on the same result: the first to finish wins; the other gets 409 `ASSESSMENT_FINISHED`, as between two reviewers today |

## 4. Scope

- **Back:** an "acting role" on every Admin write (validations, comments, quick comments, decisions, deletes, finish) for Assessor and Lead now; TPB and PPU when P2-3916 / P2-3917 enable their rows. Step-window bypass for the Admin only. Author marked as Admin in the reviewer view, worklist "Assessed by", logs and audit. The view tells the Admin which roles they can act as on this result.
- **Front (Yeck):** a role picker in the review page for an Admin, the controls of the picked role, the "Admin" author label, the worklist "Assessed by".
- Spec updates: step-1 DD-2 and FR-2, round-2 front contract (Admin `choices`).

## 5. Non-goals

- Changing what the program sees (already no identity).
- Building TPB or PPU flows (P2-3916, P2-3917).
- Admin edits to another reviewer's comment, or Admin deletes beyond each role's own delete rules.
- Changing the conflict rule for non-admin users.

## 6. Affected users, systems and specs

| Area | Impact |
|---|---|
| `server/src/assessment/` | scope, role-steps, service (writes, ends, view), store, view model, quick comments, errors, OpenAPI |
| `server/src/users/` | conflict rule exemption for ADMIN, if the Admin also takes reviewer grants |
| Data | Likely a column recording that a write was made by an Admin acting as a role (comments, decisions, finished assessments). Migration to be decided in design |
| `client/src/app/pages/workspace/review/`, `results/` | Yeck: role picker, author label, worklist |
| Specs | `assessment/step-1-assessment` (DD-2, FR-2), `escalation/round-2` (front contract), P2-3914 export ("Admin" as author) |

## 7. Visual reference

None. The role picker is a small control on the existing review page; Yeck designs it.

## 8. Requirement delta preview

**ADDED**
- An Admin acts as a chosen reviewer role on a result, ignoring step dates, within the result's round and state.
- The acting role travels with each Admin write; the author shows as Admin to reviewers and admins.
- The view lists the roles the Admin may act as on this result, and the controls follow the picked role.

**MODIFIED**
- Step-1 FR-2 / DD-2: "Admin is always read-only" becomes "Admin reads by default and writes as a chosen role".
- Round-2 contract: the Admin's `choices` are no longer always `[]` when acting as Lead.
- Assessor / Lead conflict: not applied to ADMIN.

**REMOVED**
- Nothing.

## 9. Approach options

| Option | How | Trade-off |
|---|---|---|
| A. Acting role per request (recommended) | The Admin sends `actingRole` (header or query) on reads and writes; the server checks ADMIN_ACCESS, takes that role's step row, waives only the date window, and records `acted_as_admin` on what it writes | One code path per role, explicit audit, no fake grants. Needs a contract change and a small migration |
| B. Auto-grant the Admin every reviewer role | Give admins live grants and assignments on every timeline | No new code path, but pollutes scope data, hits the conflict rule, still blocked by step dates, and the Admin cannot be told apart in the view |
| C. A separate admin write API | New `/admin/...` routes mirroring the reviewer ones | Duplicates every rule; drift between the two paths |

## 10. Recommended approach

Option A. It reuses the role-step table (one row per role, as the design intended) and only adds: who may act as a role (ADMIN_ACCESS), a waived date window for that caller, and an audit flag. The front adds one picker and keeps gating on `writable` / `decidable`.

## 11. Risks, dependencies and open questions

| # | Item |
|---|---|
| Q1 | Business confirmation of R1–R7 by the QA business owner (Ángel) |
| Q2 | Does the Admin's finish count as "Assessed by: Admin" in the worklist and export (P2-3914)? |
| Q3 | Writing after a step closes: does a late Admin finish of round 1 still release `not_qaed` / `qaed` to Reporting if the program window already passed? |
| Q4 | Quick comments: does the Admin see the picked role's shared list? |
| Risk | Writes outside the dates can reopen states other steps already rely on; R6 keeps the state machine as the guard |
| Risk | Front and back must ship the `actingRole` contract together; until then the Admin stays read-only |

## 12. Success criteria

- An Admin with no reviewer grant validates, comments and finishes a round-1 result as Assessor, and decides and finishes a round-2 result as Lead, with the step closed.
- The result ends and releases exactly as when a reviewer does it.
- Reviewers see "Admin" as the author; the program view is unchanged.
- An Admin cannot act as a role that does not fit the result's round or state.

## 13. Next step

```text
/akili-specify admin/acts-as-reviewer
```
