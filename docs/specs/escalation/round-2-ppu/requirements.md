# Round 2, step 5: the PPU — Requirements

## 1. Document Control

| Spec path | Status | Ticket | Depth | Last updated |
|---|---|---|---|---|
| `docs/specs/escalation/round-2-ppu` | Built on the back lead's brief (2026-11-26); review on the pushed branch | P2-3917 | Standard (one migration) | 2026-11-26 |

| Field | Value |
|---|---|
| Type / Deliverable | Change / software |
| Source | Jira P2-3917 (AC1 … AC9), read 2026-11-26 |
| Decisions | Back lead, 2026-11-26: AC6 is read on open and the detection date is stored (OQ-1). § 8 |
| Extends | `escalation/round-2` (§ 12) · `escalation/round-2-tpb` · `admin/acts-as-reviewer` |

## 2. Executive Summary

In step 5 the PPU sees the results the TPB ended **Pending PPU**. Each comment the TPB decided `tpb_agree_assessor` is a case. The PPU marks each case **Done**, with an optional comment:

- Done turns the field green.
- The Done that leaves every core field green and no case open ends the result **Quality Assessed**, with one `qaed` release.
- There is no Finish, and no date window.
- When step 5 closes with a case still open, the result reads **Unresolved**.

## 3. Glossary

| Term | Meaning |
|---|---|
| PPU case | A comment in state `tpb_sided_assessor`, with the TPB's `tpb_agree_assessor` decision and its reason |
| Done | The PPU decision `ppu_done` (`comment_decisions`, `role_code = 'PPU'`, body optional). At the end the comment moves to `done` |
| Step-5 effective green | The PPU's stored mark, else the step-4 one, else the step-3 one, else the carried round-1 green |
| Unresolved | Pending PPU **and** the timeline's `ppu` step is closed |
| Reporting change | The current Reporting value of a case field differs from the round-2 snapshot (the value the Lead and the TPB judged) |

## 4. System Context & Scope

**In scope:**

- the PPU row, worklist, view, Done / undo;
- the automatic end;
- `unresolved`;
- AC6;
- quick comments;
- Admin as PPU;
- audit and logs;
- migration `0015`;
- the front contract.

**Out of scope:** see `proposal.md` § 5.

**Current behavior:** cited in `proposal.md` § 2.

## 5. Stakeholders / Personas

| Role | Scope | Needs |
|---|---|---|
| PPU | Global role: every result type; their program scope; the timelines they are assigned to | See each case with its whole history, mark it Done, see what changed in Reporting |
| ADMIN | Every timeline | Sees Pending PPU and Unresolved; acts as PPU with `X-Acting-Role: PPU` |
| Lead, TPB | Unchanged | Their read-only views show the current status (Pending PPU, Unresolved, Quality Assessed) |
| PROGRAM | Their program | Unchanged: never sees the review outcome (round-2 DD-11 already covers `done`) |
| Front (Yeck) | Review page, worklist | A stable contract |

## 6. Functional Requirements

### FR-1: Review structure (AC1)

The PPU's view SHALL keep the step-1 structure. Fields with a PPU case are flagged in place: their `thread[]` holds a decidable item.

### FR-2: Scope (AC2)

The system SHALL list, for a PPU, the round-2 memberships whose TPB (step-4) assessment ended `escalated`, within the PPU's program scope. The PPU is a global role (every result type, round-2-tpb DD-T9). Listing and writing have **no date window**: the result is listed and writable whatever the state of step 5. The timeline must have a `ppu` step.

#### Scenario: Pending PPU listed and writable at any date

- GIVEN result R that the TPB ended `escalated`, and a PPU assigned to the timeline
- WHEN the PPU lists the timeline before, during or after step 5
- THEN R is listed (Pending PPU, or Unresolved once step 5 closed) and opens writable
- BUT a result the TPB has not ended, or ended Quality Assessed, must NOT be listed, and opening it is the scope 404

#### Scenario: Finished results stay visible

- GIVEN the PPU's last Done ended R Quality Assessed
- THEN R is still listed, read-only (`finished`)

### FR-3: Context of each case (AC3)

Each `thread[]` item of the PPU's view SHALL carry:

- the comment and its value then (the field's own value is now);
- the program's response and clarifications;
- the Lead's decision with its reason (`leadDecision`);
- the TPB's decision with its reason (`tpbDecision`);
- the PPU's own decision (`decision`);
- `round`.

Only items in state `tpb_sided_assessor` are decidable, with choice `ppu_done`.

### FR-4: Done (AC4, AC5)

`PUT …/assessment/decisions/:commentId` SHALL accept `{ decision: 'ppu_done', body? }` from a PPU on a case. The body is optional (trimmed, 1 to 2,000 characters when sent). The system stores who and when. Nothing marks Done but this request (AC5).

#### Scenario: Done with and without a comment

- WHEN the PPU marks case C Done with no body
- THEN the decision is stored with `body: null`, the PPU's id and the time
- AND with a body, the trimmed body is stored

#### Scenario: Wrong item or value

- WHEN the PPU marks a comment that is not a case, or sends another role's value
- THEN 409 `ASSESSMENT_DECISION_INVALID`, nothing written
- AND a Lead or TPB sending `ppu_done` gets the same 409

### FR-5: Undo a Done (DD-P3)

`DELETE …/assessment/decisions/:commentId` SHALL clear the PPU's Done until the result ends. The field turns grey again. Once the result is Quality Assessed, every write is 409 `ASSESSMENT_FINISHED`.

### FR-6: Done validates; the last Done ends (AC7, AC9)

A Done SHALL turn the field green in the PPU's step-5 assessment once every case on the field is Done. The Done that leaves every core field effectively green, with no case open, SHALL end the result `quality_assessed` in the same transaction:

- one `qaed` release;
- the cases move to `done` (one `comment_events` row each, actor role `PPU`);
- audit `end_quality_assessed`.

Reporting receives Quality Assessed only through that release (AC9).

#### Scenario: Last Done ends the result

- GIVEN two cases on two fields
- WHEN the PPU marks the first Done
- THEN `status: pending`, and there is no release
- WHEN it marks the second Done
- THEN `status: quality_assessed`, one `qaed` release, both comments `done`

### FR-7: No Finish

A PPU's `POST …/assessment/finish`, validation, comment, delete or AI request SHALL be refused: 403 `ASSESSMENT_READ_ONLY` for the writes, and the existing 403 `AI_SUGGESTIONS_FORBIDDEN` for the AI.

### FR-8: Unresolved (AC8)

The status SHALL be `unresolved` while the result is Pending PPU **and** the timeline's `ppu` step is closed. It applies:

- in the view header;
- on worklist rows, filters and counters, for the PPU and for the Admin.

A Done still works after step 5 closed, and the last one ends the result Quality Assessed.

| Current assessment | Step 5 | Status |
|---|---|---|
| TPB (step 4) ended `escalated`, no PPU row | open or upcoming | Pending PPU |
| TPB (step 4) ended `escalated`, no PPU row | closed | Unresolved |
| PPU (step 5) `pending` | open or upcoming | Pending PPU |
| PPU (step 5) `pending` | closed | Unresolved |
| PPU (step 5) `quality_assessed` | any | Quality Assessed |

### FR-9: Changed in Reporting (AC6)

When a PPU opens a result with open cases, the system SHALL read the case fields' current values from Reporting and compare each with the round-2 snapshot. On the first difference for a (membership, field), it stores the date. The view then shows `changedInReporting: { detectedAt }` on that field to every reader of the round-2 view.

If Reporting cannot be read, the view still opens, with the marks already stored.

#### Scenario: Program changed the field

- GIVEN case field F, whose Reporting value differs from the snapshot
- WHEN the PPU opens the result on 1 Dec
- THEN F reads `changedInReporting: { detectedAt: '2026-12-01T…' }`
- AND a later open keeps the 1 Dec date

### FR-10: Worklist counters

For a caller whose only rows are PPU rows:

- `pending_ppu` and `unresolved` count as pending;
- `quality_assessed` counts as finished.

For every other caller, `unresolved` counts as finished, like `pending_ppu` (DD-T10).

### FR-11: Quick comments

A PPU SHALL read and save the PPU role's quick comment list.

### FR-12: Admin as PPU

An Admin with `X-Acting-Role: PPU` SHALL act as the PPU on any type and program, on a result the TPB ended `escalated` (R6). The PPU has no date window, so the Admin waiver changes nothing here.

### FR-13: Audit and logs

Each request SHALL leave its audit rows:

- `decision_set` / `decision_clear` for each Done or undo;
- `end_quality_assessed` for the end;
- one `assessment` log line per request (action `decide` / `decision_clear`, ids only).

An AC6 read failure logs one warn line with ids and a fixed word.

## 7. Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-1 | The PPU view adds a constant number of statements: one thread read and the step-3 / step-4 validations, plus the AC6 reads and writes (one details call, one insert, one select) |
| NFR-2 | One migration, `0015_reporting_field_changes`, additive, with a down script |
| NFR-3 | The program view is unchanged |
| NFR-4 | AC6 never blocks the view: any Reporting error is logged and skipped |

## 8. Decisions

| # | Question | Answer |
|---|---|---|
| OQ-1 | AC6: how to know a field changed in Reporting? | Read on open; store the first detection date (back lead, 2026-11-26). Migration `0015` |
| OQ-2 | Can a Done be undone? | Yes, until the result ends (DD-P3, proposed) |
| OQ-3 | Which results does the PPU list (AC2 says "Pending PPU")? | What reached step 5, like the TPB's OQ-2: Pending PPU and Unresolved, and the ones it ended stay visible read-only |
| OQ-4 | Overview | It has no back-end endpoint today. `unresolved` is produced in the worklist (status, filter, counters) for the Admin; the Overview reads it when it is wired |

## 9. Requirement ID Index

| AC | FR |
|---|---|
| AC1 | FR-1 |
| AC2 | FR-2, FR-10 |
| AC3 | FR-3 |
| AC4, AC5 | FR-4 |
| AC6 | FR-9 |
| AC7 | FR-6 |
| AC8 | FR-8 |
| AC9 | FR-6 |
| Brief | FR-5, FR-7, FR-11, FR-12, FR-13 |
