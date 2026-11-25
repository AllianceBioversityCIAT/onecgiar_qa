# Proposal: Reporting's visible_when in the assessment view (F-015)

| Field | Value |
|---|---|
| Type | Bug |
| Deliverable | software |
| Spec Path | bugfix/catalog-visible-when |
| Parent | assessment/step-1-assessment (FR-8, FR-9) · admin-config/field-configuration (catalog) |
| Source | QA Platform Test Findings Log, F-015 (Mariagiulia Mariani, 2026-11-23) |
| Approval | back lead, 2026-11-24 |
| Branch | `fix/F-015-visible-when` from `origin/staging-center` |

## Symptom

"I see components for all IA scores." Expected: "Components only for Principal score."

## Root cause

The Reporting catalog already carries the rule: each `general.*_impact_areas` has `visible_when: { field: general.*_tag, operator: eq, value: 3 }` (3 = Principal). `shapeCatalog` dropped `visible_when`, so the view showed every field the configuration allows. Reporting also sends the components for non-principal scores (seen on qatest, result 10159: gender tag "2" with components ["5","12","13"]).

## Expected

A top-level field whose `visible_when` is false on the result's values is not in the assessment view (Review and SP view).

## Acceptance criteria

1. An Impact Area component is shown only when its score is 3 (snapshot sends `"3"`, catalog `3`: compared loosely).
2. Fails open: a condition on a field the snapshot lacks, or on a non-scalar value, counts as met.
3. A condition this grammar does not know (`eq`, `in`, `any`, `all`) reads as none; the catalog is never refused for it.
4. A core Assessed field is never hidden (Finish must reach it); the ToC group is never hidden (OQ-7).
5. No write path, no API contract, no migration changes.
