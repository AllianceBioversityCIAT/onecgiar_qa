# Tasks: Reporting's visible_when in the assessment view (F-015)

## T-1: Parse and apply visible_when

- **Status:** [x]
- **Size:** S
- **Scope:** `field-config-catalog.ts`, new `visible-when.ts`, `assessment-view.ts`, specs.
- **Verification:** server `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm test:e2e`.
- **Falsifier:** skip the `isVisible` check → "shows the Impact Area components only under a Principal score" is red.
- **Disqualifier:** any change to a write path, the config rules or the API contract.
