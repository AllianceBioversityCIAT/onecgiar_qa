# Tasks: live field visibility (F-005)

## T-1: Lay the latest version's Hidden / View only over the kept version

- **Status:** [x]
- **Size:** S
- **Requirements:** R-1 … R-4
- **Design refs:** D1 … D5
- **Scope:** new `server/src/admin-config/field-config/live-visibility.ts`; `field-config.module.ts` (port), `field-config.service.ts` (`latestVersionItems`), `assessment/assessment.service.ts` (`configOf`); fakes in `test/support/in-memory-assessment.ts`, `test/support/fake-ai-jobs.ts`; `server/src/admin-config/AGENTS.md`.
- **Tests:** see design § Tests.
- **Verification:** server `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm test:e2e`.
- **Falsifier:** `configOf` returns the kept items → the F-005 service tests are red.
- **Disqualifier:** any change to a write path, to `versionFor`, or to the API contract.

## T-2 (front, Yeck): publish dialog copy

- **Status:** [ ]
- **Scope:** `client/src/app/pages/workspace/fields/fields-publish-confirm.ts`, under "Keep their current version": "Hidden and View only changes reach them now; Assessed and Core changes don't."
