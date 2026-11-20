# Tasks: release sweep

## T-1: Periodic release sweep with backoff

- **Status:** [x]
- **Size:** M
- **Requirements:** R-1 … R-5
- **Design refs:** D1 … D7, Round-1 impact
- **Scope:** new `server/src/assessment/release-sweeper.ts`; `release.service.ts` (backoff lease on every failure path; `dispatch({ ignoreBackoff })` for the admin retry), `release.store.ts` (backoff UPDATE; claim that ignores the lease-as-backoff for the retry but never takes a row leased by a send in flight), `releases.controller.ts` (retry passes the flag), `assessment.module.ts`, config (`RELEASE_SWEEP_INTERVAL_MS`, default 60000, 0 disables; validated at startup; documented in `server/src/config/AGENTS.md`), `server/src/assessment/AGENTS.md`.
- **Tests:** unit: backoff table, each failure path sets the lease, stuck log at 10, sweeper re-arms after a throw, no overlap, shutdown clears the timer and awaits an in-flight sweep (fake timers), retry ignores backoff. e2e: regression scenario (red first); two parallel sweeps send a row once.
- **Verification:** server `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm test:e2e`; client `npm run build`.
- **Falsifier:** sweeper disabled → regression e2e red.
- **Disqualifier:** any change to the end transaction, to the post-end dispatch, or a timer that runs in unit/e2e by default.
- **Review:** full.
- **Skills:** tdd, nestjs-best-practices, error-handling-patterns
