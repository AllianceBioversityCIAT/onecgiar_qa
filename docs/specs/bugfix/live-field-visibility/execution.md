# Execution log: live field visibility (F-005)

| Field | Value |
|---|---|
| Spec | bugfix/live-field-visibility |
| Branch | fix/F-005-live-field-visibility (from origin/staging-center `fee3d3a`) |
| Found in | MG testing log F-005, 2026-11-23; diagnosed on qatest 2026-11-24 (timeline 43, result 10159, version 8) |

### T-1 — PASS (2026-11-24)

- Red: `live-visibility.spec.ts` with no module (no tests run); F-005 service tests red with the overlay removed (falsifier), green with it.
- NFR-2 budgets moved by the two statements of `latestVersionItems` (unit 8 → 10 / 6 → 8; e2e 8 → 10 / 6 → 8; round-2 view 10 → 12).
- Verification: unit 4273 passed / 6 skipped · e2e 1337 passed · lint exit 0 · build ok.
- Disqualifier check: no write path, no `versionFor`, no contract or migration touched.
