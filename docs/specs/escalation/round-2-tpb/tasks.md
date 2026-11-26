# Round 2, step 4: the TPB (P2-3916) — Tasks

Each back task closes with its own tests. The push runs the whole gate:

```
cd server && pnpm lint && pnpm build && pnpm test && pnpm test:e2e
```

All the tasks touch `server/src/assessment/`, so they run serially.

```
T-1 → T-2 → T-3 → T-4 → T-5 → T-6 → T-7 → T-8
```

| Task | What | FR | Tests |
|---|---|---|---|
| T-1 | Rules: TPB transitions (actor `tpb`), `isTpbDecidable`, `tpbFieldGreen`, `tpbUndecidedFields`; status input `currentStep` with rows `pending_tpb_review` (tpb, pending) and `pending_ppu` (tpb, escalated) in TS and SQL | FR-3, FR-6, FR-8, FR-9 | `comment-transitions.spec.ts`, `round-two-rules.spec.ts`, `qa-status.spec.ts` |
| T-2 | Scope: enable the TPB row; `leadEscalated` in `MembershipFacts`, `rowCovers` and `reviewerRowCondition`; the membership read gains `leadAssessment`; the worklist SQL feeds `currentStep` | FR-2, FR-9, FR-12 | `role-steps.spec.ts`, `scope.spec.ts`, store SQL specs, in-memory twin |
| T-3 | Thread read: `findEscalationThread` (one statement, two decision joins), plus its in-memory twin | FR-4, NFR-1 | store spec |
| T-4 | View: own-step assessment (DD-T7); TPB annotation (`round`, `leadDecision`, decidable escalated items, step-4 effective green) | FR-1, FR-3, FR-4, FR-13 | `assessment-view.spec.ts`, view e2e |
| T-5 | Decide / clear: TPB branch, DTO values, field green, audit; Lead pinned version for the step-4 row (DD-T4) | FR-5, FR-6, FR-7, FR-14 | decisions e2e |
| T-6 | Finish and end: undecided check, the two ends, TPB states and events, no release on `escalated`; refusal of validations, comments and deletes | FR-8, FR-11, FR-14 | end e2e |
| T-7 | Admin as TPB; quick comments for TPB | FR-10, FR-12 | e2e |
| T-8 | Full-flow e2e (Lead escalates → TPB decides → `quality_assessed` / `pending_ppu`); `assessment/AGENTS.md` "Round 2: the TPB"; `front-contract.md` | all | `assessment-round-two-tpb-flow.e2e-spec.ts` |

## Status

| Task | Status |
|---|---|
| T-1 … T-8 | [ ] |
