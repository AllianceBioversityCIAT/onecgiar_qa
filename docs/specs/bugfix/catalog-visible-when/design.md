# Design: Reporting's visible_when in the assessment view (F-015)

- D1 `field-config-catalog.ts`: `CatalogField.visibleWhen?: VisibleWhen`, parsed leniently by `conditionOf` (unknown shapes → absent).
- D2 New pure `field-config/visible-when.ts`: `isVisible(condition, resultType, values)`. `$result_type` reads the result type. Loose equality: number ↔ numeric string, boolean ↔ "true"/"false"/1/0. Missing key or non-scalar value → met.
- D3 `assessment-view.ts` `fieldOf`: after the mode, drop the field when `isVisible` is false, except ToC fields and Assessed core fields.
- Out of scope: subfield `visible_when` inside list entries (evidence `*_related` flags): front (F-022).

## Tests

- `visible-when.spec.ts`: eq/in, string vs number, booleans, `$result_type`, any/all, fail open.
- `field-config-catalog.spec.ts`: 48 fields keep a condition; unknown operator ignored.
- `assessment-view.spec.ts`: components shown under 3, hidden under 2, kept with no score, core never hidden, ToC never hidden.
