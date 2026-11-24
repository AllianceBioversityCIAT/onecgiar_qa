# Design and requirements: live field visibility (F-005)

| Field | Value |
|---|---|
| Depth | Lite (Bug Mode) |
| Approved | back lead, 2026-11-24 |
| Amends | admin-config/field-configuration S-13 (visibility only) |

## Requirements

- **R-1** The assessment view SHALL lay the cycle's latest published version over the kept version (the assessment's pinned one, else the timeline's) for every field whose visibility is Hidden or View only on **both** sides (AC1, AC2).
- **R-2** A field Assessed on either side SHALL read as kept; Core and AI input SHALL always read as kept (AC3).
- **R-3** Write paths SHALL NOT change (AC4).
- **R-4** No contract or schema change (AC5).

### Scenario: regression (red before the fix)

- GIVEN an assessment that pinned a version where `general.description` is View only
- AND the cycle's latest version makes it Hidden
- WHEN the view is opened
- THEN the field and its value are absent, and an Assessed core field is still Assessed and core

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Pure rule `withLiveVisibility(resultTypeKey, kept, latest)` in `admin-config/field-config/live-visibility.ts` | Testable alone; the view builder stays as it is |
| D2 | New port method `FieldConfigEffective.latestVersionItems(cycleId, resultTypeKey)`: `listVersions` + `listVersionItems` (two statements), `null` with no version | Reuses the store; no new query, no store-interface change |
| D3 | Applied in `AssessmentService.configOf`, read in parallel with the kept items | `open`, `viewInputsFor` (SP view) and `resolveForAi` all go through it; writes use their own resolution (`effectiveConfig` / `versionItems` under the lock), so R-3 holds by construction |
| D4 | The view reads two statements more (NFR-2 budgets: 8 → 10 with no assessment row, 6 → 8 with one; round-2 view 10 → 12) | Accepted: constant, independent of fields and comments |
| D5 | A field with no item reads Hidden on either side (glossary) | Same rule as `modeOf` |

## Tests

- Unit: `live-visibility.spec.ts` (9 cases: both directions, missing items, Assessed on either side, flags kept, identity, other result types).
- Unit: `assessment.service.spec.ts` › F-005 (regression on a pinned assessment; started timeline with no row; never Assessed). Falsifier: overlay removed → both red.
- NFR-2 budgets updated in `assessment.service.spec.ts`, `test/assessment-view.e2e-spec.ts`, `test/assessment-round-two-view.e2e-spec.ts`.
