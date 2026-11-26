# Proposal: Round 2, step 5: the PPU closes the cases (P2-3917)

| Field | Value |
|---|---|
| Spec Path | `escalation/round-2-ppu` |
| Type | Change |
| Deliverable | software |
| Approval Mode | gated. The back lead reviews the pushed branch and merges it (brief of 2026-11-26) |
| Requirement source | Jira P2-3917, read 2026-11-26 (9 ACs). Design `escalation/round-2/design.md` § 12 (PPU column); `escalation/round-2-tpb` (DD-T1 … DD-T10) |
| Visual source | None. Yeck builds the front from `front-contract.md` |
| Owners | Back: Juanda (`server/`). Front: Yeck (`client/`) |
| Branch | `feature/P2-3917-ppu-close-cases` from `origin/staging-center` (`eb2db04`) |
| Depends on | `escalation/round-2` (P2-3912, `0013`), `escalation/round-2-tpb` (P2-3916), `admin/acts-as-reviewer` (`0014`) |

## 1. Intent

When the TPB sides with the assessor, the comment becomes a PPU case. In step 5 the PPU follows up with the program outside the platform. Once the result has changed in the Reporting Tool, the PPU marks each case **Done**.

- **The last Done ends the result.** Quality Assessed, with one `qaed` release.
- **There is no Finish, and no date window.**
- **When step 5 closes,** the cases not yet Done show as **Unresolved** until the PPU marks them.

## 2. Problem / Current behavior

| Today | Evidence |
|---|---|
| The PPU row is declared and disabled | `server/src/assessment/role-steps.ts` (row `PPU`, `enabled: false`) |
| `ppu_done` is declared, and its body may be null | `schema/comment-decisions.ts` (enum, CHECK `body` null only for `ppu_done`) |
| `done` is a declared comment state, and the SP view already hides it (DD-11) | `schema/assessment-comments.ts`; `sp-view/sp-state.ts` `REVIEW_STATES` |
| `unresolved` is declared, with no status rule | `qa-status.ts` (`QA_STATUSES`, no row) |
| `pending_ppu` counts as finished for everyone | `worklist.service.ts` `FINISHED_STATUSES` (DD-T10) |
| The AI suggestion is forbidden to a PPU | `ai-suggestions-rules.ts` (`PPU` → `forbidden`) |
| Reporting gives no change date per field: only the current values | `ingestion/results-feed.port.ts` (`details`); a round-2 membership is never reloaded (`ALREADY_IN_THIS_TIMELINE`, `ingestion/loads.unit-of-work.ts`) |
| The Admin Overview has no back-end endpoint yet: it shows sample data | `client/src/app/pages/workspace/overview/` (sample-data notice); the server has no overview route |

## 3. Product calls

| Topic | Call | Source |
|---|---|---|
| AC6 "Changed in Reporting Tool on <date>" | Read Reporting when the PPU opens the result. Store the first date a difference is seen (migration `0015`) | Back lead, 2026-11-26 |
| Undo a Done | Allowed until the result ends (DD-P3) | Proposed here |
| Admin as PPU | As for the TPB: any type and program. The result must be in step 5 | Brief + admin R1–R7 |

## 4. Scope

**Back:**

- the PPU row;
- the worklist scope (results the TPB ended `escalated`) and the PPU's counters;
- the view (decidable cases, the full context, AC6 mark);
- Done and its undo;
- the automatic end to Quality Assessed;
- the `unresolved` status;
- quick comments;
- an Admin acting as PPU;
- audit and logs;
- migration `0015_reporting_field_changes`.

**Docs:**

- this spec;
- `execution.md`;
- the front contract;
- the assessment guide.

## 5. Non-goals

- Notifications between the PPU and the program.
- Changes to already-Quality-Assessed results (NOST-400 / NOST-401).
- The AI suggestion for the PPU.
- An Overview endpoint. It has none today; `unresolved` is ready in the worklist for when it is wired.
- Reloading a round-2 membership.

## 6. Success criteria

The full path works: the Lead escalates → the TPB sides with the assessor → Pending PPU → the PPU marks Done → Quality Assessed with one `qaed`.

When step 5 closes with a case open, the result reads Unresolved. A later Done still ends it Quality Assessed.
