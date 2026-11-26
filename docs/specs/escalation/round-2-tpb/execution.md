# Round 2 — contract adjustments for the front (Lead, TPB, PPU) — Execution log

| Field | Value |
|---|---|
| Branch | `feat/round-2-contract-adjustments` from `origin/staging-center` `dd58393` |
| Executor | Claude (back), on the back lead's brief of 2026-11-26 (Yeck's three requests while wiring the round-2 front) |
| Scope | Additive only, no migration: `header.reviewerRole`, `counters.byStatus`, `fields` on `ASSESSMENT_FIELD_ESCALATED` |
| Gate at the push | `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm test:e2e` in `server/` (§ Gate) |
| P2-3916 log | The TPB story itself ran before this file existed; its record is in `tasks.md` and the commits `e20f0fe..cf48588` |

## What was done

| # | Request | Change | Commit |
|---|---|---|---|
| 1 | Deterministic effective role in the view | `effectiveRow` in `scope.ts` (DD-T11, `design.md` § 7). `open()` takes its role from it and returns it as `header.reviewerRole`; `ownAssessment`, the TPB / PPU branches and `actingRole` use the same role. `writeDecision` writes with that row only (no fallback to another covering row), so decisions, clears and finish (`decision.row.role`) follow it; the withdraw audit `actorRole` too. OpenAPI: `reviewerRole` on the header; the `actingRole` / `actingRoles` descriptions list `TPB` and `PPU` | `fb24395` |
| 2 | Count by status in the worklist | `counters.byStatus` on `WorklistCounters` and `WorklistCountersModel`: every QA status → count, from the same grouped read as `total` (filters ignored, Auto-validated and the round-2 statuses included). Existing counters unchanged | `cae7e73` |
| 3 | `ASSESSMENT_FIELD_ESCALATED` with `fields` | The error carries the sorted escalated keys the request named (the comment's field on an agree); the global filter forwards them as `error.fields`; `api-response.ts` and the controller descriptions say so | `8df1659` |
| — | Docs | DD-T11 and premises P-9, P-10 in `design.md`; § 9 in the TPB and PPU front contracts (with JSON examples); a section in `server/src/assessment/AGENTS.md`; this log | (docs commit) |

## Tests added or changed

| Spec | What it pins |
|---|---|
| `src/assessment/scope-effective-role.spec.ts` (new, 9) | Lead + TPB: `pending` → Lead, `pending_tpb_review` → TPB, in both row orders; three roles on `pending_ppu` → PPU; an ended Lead review → Lead; X-Acting-Role honored when the round fits, `ASSESSOR` on round 2 → none; ADMIN without it → none; `writeDecision` writes as Lead in step 3 and as TPB in step 4, and never falls back to the Lead row (`step_upcoming`); Admin acting TPB on a non-escalated result → `admin_read_only` |
| `test/assessment-round-two-effective-role.e2e-spec.ts` (new, 6) | Over HTTP, a Lead also assigned as TPB: `pending` reads and decides as `LEAD_ASSESSOR`; a non-admin `X-Acting-Role` is ignored; Admin with / without the header. `pending_tpb_review` reads as `TPB` (`assessment: null`, TPB choices), decides and finishes as TPB on its own step-4 row; Admin acting as Lead reads the Lead's ended review |
| `src/assessment/worklist.service.spec.ts` | `byStatus` in the three existing counter pins; a new `describe` (2): every status zero-filled, round-2 statuses and Auto-validated counted, a `null` group in `total` only; filters ignored (the count read never gets them) |
| `test/assessment-worklist.e2e-spec.ts`, `test/assessment-round-two-scope.e2e-spec.ts`, `test/assessment-round-two-ppu-flow.e2e-spec.ts` | `byStatus` over HTTP: step 1, `pending_tpb_review` + `returned_to_program`, `pending_ppu`, `unresolved` under a status filter (sum = `total`) |
| `assessment.errors.spec.ts`, `http-exception.filter.spec.ts`, `assessment-decisions.service.spec.ts`, `assessment-round-two-end.service.spec.ts`, `test/assessment-round-two-decisions.e2e-spec.ts` | `ASSESSMENT_FIELD_ESCALATED` carries `fields` (validation, Check all, agree on a field another comment escalated); the filter forwards strings only |
| `assessment.service.spec.ts`, `test/assessment-view.e2e-spec.ts` | The step-1 header pins gain `reviewerRole: 'ASSESSOR'` |
| `test/support/assessment-app.ts` | `grant(userId, roleCode, resultTypeKey?)`: one more role for a test user |

## Findings during the run

| # | Finding | Action |
|---|---|---|
| F-1 | The AI route picks its audience from the role list (`aiAudienceOf`: Lead before TPB), not from the effective role. A Lead who is also TPB gets the Lead's AI mode on a `pending_tpb_review` result | Not changed (outside the brief). Noted in `AGENTS.md`; a one-line change if wanted (`aiAudienceOf` over `effectiveRow`) |
| F-2 | The OpenAPI `actingRole` enum listed only `ASSESSOR` and `LEAD_ASSESSOR` since P2-3916 | Widened to the four reviewer roles with `reviewerRole` |
| F-3 | Behavior change for a person with two round-2 roles: on an escalated result while step 3 is still open, the Lead row used to be writable (on an ended review, so every write was 409 `ASSESSMENT_FINISHED`); now the view is `step_upcoming` until step 4 opens | Intended by DD-T11 (one role per result) |
| F-4 | `sp-response.service.ts` still takes `reviewerRows[0]` as the audit role of a clarification answer | Not changed: it is the round-1 assessor flow, where a caller has a single reviewer row |

## Gate (in `server/`, 2026-11-26)

| Command | Result |
|---|---|
| `pnpm lint` | exit 0, no findings |
| `pnpm build` | exit 0 |
| `pnpm test` | Test Files 133 passed, 1 skipped (134); Tests 4436 passed, 6 skipped (4442) |
| e2e | Test Files 46 passed (46); Tests 1385 passed (1385). Run as `vitest run --config ./vitest.config.e2e.ts --maxWorkers=2` over all 46 `test/*.e2e-spec.ts` (the same config and files as `pnpm test:e2e`): the local RAM guard blocked the default-worker `pnpm test:e2e` (needs 4.5 GB free) |
| `client: npx ng build` | OK (team rule; the client is not touched) |
| `tsc --noEmit` | 25 errors, all pre-existing in spec / test-support files (baseline unchanged) |
