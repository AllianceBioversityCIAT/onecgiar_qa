# Tasks: latest field config for results nobody started (F-012)

## T-1: Resolve a result nobody started to the cycle's latest version

- **Status:** [x]
- **Size:** S
- **Requirements:** R-1 … R-3
- **Design refs:** D1 … D4
- **Scope:** `field-config.module.ts` (port), `field-config.service.ts` (`currentFor`), `assessment/assessment.service.ts` (`effectiveConfig`, `configOf`); fakes in `test/support/in-memory-assessment.ts`, `test/support/fake-ai-jobs.ts`; `server/src/admin-config/AGENTS.md`.
- **Verification:** server `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm test:e2e`.
- **Falsifier:** `effectiveConfig` on `effectiveFor` → F-012 tests red.
- **Disqualifier:** any change to `versionFor`, the publish preview, ingestion, the API contract or the schema.

## T-2 (front, Yeck): publish dialog copy

- **Status:** [ ]
- **Scope:** `fields-publish-confirm.ts`, "Keep their current version": "Changes reach results nobody has started; results already in review keep their version (Hidden / View only changes reach all)."
