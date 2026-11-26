# Proposal: live field visibility (F-005)

| Field | Value |
|---|---|
| Type | Bug |
| Deliverable | software |
| Spec Path | bugfix/live-field-visibility |
| Parent | admin-config/field-configuration (S-13, FR-9) · assessment/step-1-assessment (DD-3, FR-9) |
| Source | QA Platform Test Findings Log, F-005 (Mariagiulia Mariani, 2026-11-23) |
| Approval | back lead, 2026-11-24 (options 1 + 2 of the F-005 analysis) |
| Branch | `fix/F-005-live-field-visibility` from `origin/staging-center` |

## Symptom

"Assessment view does not follow the field configuration (Reporting year set to Hidden is still visible)."

## Reproduction (qatest, 2026-11-23, Rome time)

1. 14:40: timeline 43 "December testing batch" opens (step 1).
2. 14:45: the QA Admin publishes field-config version 8 with `general.reported_year` Hidden for every result type.
3. Result 10159 (Policy change) is assessed and finished in timeline 43.
4. `GET /timelines/43/results/10159/assessment` still returns `general.reported_year` in mode `view` (value 2026).

## Root cause

Not the view: `buildAssessmentView` drops Hidden fields. The view reads the version the timeline resolved to, and a started timeline keeps the latest version published **before** it opened (S-13, `versionFor`); an assessment then pins it (DD-3). Version 8 came 5 minutes after the opening, so timeline 43 kept version 7.

S-13 protects reviewer work: a field cannot gain or lose Assessed, Core or AI input under a running assessment. It was accepted over the BA's Q-8 wording ("fields are removed or added on results when batches are on-going"). Hiding or showing a **read-only** field carries no reviewer work, so it does not need that protection.

## Expected

A move between Hidden and View only in the cycle's latest version reaches every view at once, started timelines and pinned assessments included. Anything that touches Assessed, Core or AI input still waits for a timeline that has not started.

## Acceptance criteria

1. A field View only in the kept version and Hidden in the latest is absent from the assessment view (Review and SP view), value included.
2. A field Hidden in the kept version and View only in the latest is shown read only.
3. A field Assessed on either side keeps the kept item: never gains or loses Assessed in a running timeline; Core and AI input stay as kept.
4. Writes (validate, comment, decide, finish) are unchanged: they never read this overlay.
5. No API contract change; no migration.
6. Front (Yeck): the publish dialog says, under "Keep their current version", that Hidden / View only changes reach those timelines now.
