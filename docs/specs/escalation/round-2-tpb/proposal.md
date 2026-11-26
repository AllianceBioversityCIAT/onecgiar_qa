# Proposal: Round 2, step 4: the Third-Party Broker (P2-3916)

| Field | Value |
|---|---|
| Spec Path | `escalation/round-2-tpb` |
| Type | Change |
| Deliverable | software |
| Approval Mode | gated. The back lead reviews the pushed branch and merges it (brief of 2026-11-26) |
| Requirement source | Jira P2-3916, read 2026-11-26 (12 ACs). Design `escalation/round-2/design.md` § 12 (TPB and PPU on the same model) |
| Visual source | None. Yeck builds the front from `front-contract.md` |
| Owners | Back: Juanda (`server/`). Front: Yeck (`client/`) |
| Branch | `feature/P2-3916-tpb-review` from `origin/staging-center` (`fa90020`) |
| Depends on | `escalation/round-2` (P2-3912, migration `0013`), `admin/acts-as-reviewer` (migration `0014`) |

## 1. Intent

A Lead Assessor escalates a core disagreement when they side with the assessor. In step 4 the TPB settles each escalated comment, one at a time:

- **Agree with the program**: the comment closes and the field turns green.
- **Agree with the assessor**: the comment becomes a case for the PPU.

"Finish review" then ends the result:

- **Quality Assessed**, with a `qaed` release, when every core field is green;
- **Pending PPU** otherwise.

## 2. Problem / Current behavior

| Today | Evidence |
|---|---|
| The TPB row is declared and disabled | `server/src/assessment/role-steps.ts:47-54` (`enabled: false`) |
| A TPB grant gives no worklist and no write | `enabledReviewerRows()` skips disabled rows, `role-steps.ts:73-75` |
| The decision enum, the comment states and the audit actions TPB needs already exist | `schema/comment-decisions.ts:25-26`, `schema/assessment-comments.ts:33-34`; migration `0013` |
| `pending_ppu` is declared, with no status rule | `qa-status.ts:18`, `STATUS_RULES` has no row for it |
| The status reads the current step's assessment, with no notion of which step it is | `qa-status.ts:83-88` (`StatusInputs`) |
| Only a Lead decides; the decide route answers 404 to any other role | `assessment.service.ts:1325-1331` |
| The decision body accepts only the Lead values | `dto/decide-comment.body.ts:8` |
| Every round-2 end applies the Lead's decisions as comment states | `assessment.service.ts:948-981` (`applyLeadDecisions`) |
| The AI suggestion rules already give the TPB a read-only view with the copy mark | `ai-suggestions-rules.ts:40` |
| Quick comments follow the role-step rows | `quick-comments.service.ts` (`ROLE_STEPS`, round-2 P-11) |

## 3. Proposed outcome

The design in round-2 § 12, built. The changes from it are recorded as DDs in `design.md`. Product calls by the back lead (2026-11-26):

- the TPB ends **only** with Finish (no auto-end);
- the worklist lists what reached step 4.

## 4. Scope

- **Back:**
  - the TPB row;
  - the worklist scope (results the Lead escalated);
  - the view: escalated items decidable, the rest read-only, with the Lead's escalation;
  - TPB decisions on the existing route;
  - step-4 effective green;
  - Finish and its two ends;
  - the `pending_tpb_review` (step 4 in progress) and `pending_ppu` status rows;
  - quick comments;
  - Admin as TPB;
  - audit and logs.
- **Docs:** this spec, a front contract for Yeck, and the assessment guide.

## 5. Non-goals

- The PPU closure, `unresolved` and "Changed in Reporting" (P2-3917).
- Escalations on non-core fields.
- Returning to the program or to the Lead.
- TPB comments or validations: the TPB only decides.
- The front (Yeck).

## 6. Affected users, systems and specs

| Area | Impact |
|---|---|
| `server/src/assessment/` | role-steps, scope, qa-status, round-two-rules, comment-transitions, service, stores, view, DTO, worklist |
| Data | No migration: `0013` already declared every value |
| Specs | `escalation/round-2` § 12 is superseded by this spec where they differ (DD rows) |
| Front | Yeck: TPB mode of the review page, worklist |

## 7. Recommended approach

Reuse the Lead's machine with a role branch:

- one assessment per membership and step (step 4);
- decisions in `comment_decisions` (`role_code = 'TPB'`);
- comment states written at the end (DD-7);
- effective green computed, never copied (DD-4 extended).

## 8. Success criteria

The Lead escalates, the TPB decides and finishes, and the result ends:

- **Quality Assessed** with one `qaed` release when the TPB sided with the program everywhere;
- **Pending PPU** with no release when the TPB sided with the assessor at least once.

The program view is unchanged.
