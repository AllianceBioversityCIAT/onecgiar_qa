# Execution log: latest field config for results nobody started (F-012)

| Field | Value |
|---|---|
| Spec | bugfix/latest-config-for-unstarted |
| Branch | fix/F-012-latest-config-for-unstarted (from origin/staging-center `4dec13d`) |
| Found in | MG testing log F-012, 2026-11-23; diagnosed on qatest 2026-11-24 (timeline 43, result 10159, version 8) |

### T-1 — PASS (2026-11-24)

- Red first: `currentFor` tests ("currentFor is not a function"); F-012 service and comment tests red with `effectiveConfig` on `effectiveFor` (falsifier).
- The F-005 test "never makes one Assessed" used a result with no row: under R-1 it now reads the latest version; split into a pinned-row test (F-005) and an unstarted-result test (F-012).
- Verification: unit 4278 passed / 6 skipped · e2e 1337 passed · lint exit 0 · build ok.
- Disqualifier check: `versionFor`, preview, ingestion, contract and schema untouched.
