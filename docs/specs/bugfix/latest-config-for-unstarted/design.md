# Design and requirements: latest field config for results nobody started (F-012)

| Field | Value |
|---|---|
| Depth | Lite (Bug Mode) |
| Approved | back lead, 2026-11-24 |
| Amends | admin-config/field-configuration S-13 for assessment; bugfix/live-field-visibility (the "never gains Assessed" rule now holds for pinned assessments only) |

## Requirements

- **R-1** For a membership with no assessment row, `AssessmentService` SHALL resolve the field configuration to the cycle's latest version, in the view (`open`, SP view, AI context) and in the write that creates the row (AC1).
- **R-2** With a row, the view SHALL keep the pinned version with the F-005 overlay (AC2).
- **R-3** Scope and errors as before (AC3); no contract or schema change (AC4).

### Scenario: regression (red before the fix)

- GIVEN a started timeline that keeps a version where `general.title` is View only, and a later version where it is Assessed
- AND a result in it that nobody has started
- WHEN an assessor opens it, and comments the title
- THEN the title is Assessed (and core) and the comment is stored

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | New port method `FieldConfigEffective.currentFor(cycleId, timelineId, resultTypeKey)`: same checks, errors and five statements as `effectiveFor`, latest version, never provisional | One resolution for read and write: the first write pins exactly what the assessor saw |
| D2 | `AssessmentService.effectiveConfig` calls `currentFor`; `effectiveFor` stays for ingestion (AI input at load) and the publish preview | Smallest change; the preview's "keep" list is still right for results already started |
| D3 | `configOf` reads the F-005 overlay only for a pinned row | With no row the latest version is already read: NFR-2 back to 8 statements with no row (8 with a row) |
| D4 | The version race keeps its guard: the row is created under the lock with the resolved version, and `PinnedVersionChangedError` re-runs once | A publication between read and write cannot pin a version nobody judged |

## Tests

- `field-config.service.spec.ts` › currentFor: a started timeline answers the latest version; scope check; no version; unknown timeline.
- `assessment.service.spec.ts` › F-012: unstarted result shows Assessed/core and View only from the latest version; F-005: a pinned row never gains Assessed.
- `assessment-comments.service.spec.ts` › F-012: a comment on a field Assessed only in the latest version is stored.
- Falsifier: `effectiveConfig` back on `effectiveFor` → the two F-012 tests red.
- NFR-2 budgets: no row 10 → 8 (unit, e2e), round-2 view 12 → 10.
