# Round 2, step 5: the PPU (P2-3917) — Tasks

Each task closes with its own tests. `execution.md` records each task and its checks. The push runs the whole gate:

```
cd server && pnpm lint && pnpm build && pnpm test && pnpm test:e2e
```

All the tasks touch `server/src/assessment/`, so they run serially: T-1 → T-2 → … → T-8.

| Task | What | FR | Tests |
|---|---|---|---|
| T-1 | Rules: `ppu` transition, `isPpuDecidable`, `ppuFieldGreen`, `ppuOpenCases`; status input `ppuStepClosed` with rows `unresolved` and `pending_ppu` (ppu, pending) in TS and SQL | FR-3, FR-6, FR-8 | `round-two-ppu-rules.spec.ts`, `qa-status.spec.ts`, `comment-transitions.spec.ts` |
| T-2 | Scope: PPU row (no date window), `tpbEscalated` in facts, `rowCovers`, `writeDecision`, `stepEscalatedSql`; membership `tpbAssessment`; worklist `ppuStepClosed`; PPU counters | FR-2, FR-8, FR-10, FR-12 | `scope-ppu.spec.ts`, store specs |
| T-3 | Thread read with the TPB's decision; view: PPU items, `tpbDecision`, step-5 green, own step | FR-1, FR-3 | `assessment-view-ppu.spec.ts` |
| T-4 | Done / clear, the auto-end, `applyPpuDecisions`, DTO; refusals | FR-4 … FR-7, FR-13 | e2e |
| T-5 | Migration `0015` + rollback + schema; AC6 read/compare/store in the view | FR-9 | store spec, e2e |
| T-6 | Admin as PPU; quick comments | FR-11, FR-12 | e2e |
| T-7 | Full-flow e2e: Lead → TPB → PPU → Quality Assessed; step 5 closed → Unresolved → Done → Quality Assessed | all | `assessment-round-two-ppu-flow.e2e-spec.ts` |
| T-8 | `assessment/AGENTS.md` "Round 2: the PPU"; `front-contract.md`; the contracts that call the PPU not built | — | docs |

## Status

See `execution.md`.
