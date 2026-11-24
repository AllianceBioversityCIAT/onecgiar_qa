# Proposal: latest field config for results nobody started (F-012)

| Field | Value |
|---|---|
| Type | Bug |
| Deliverable | software |
| Spec Path | bugfix/latest-config-for-unstarted |
| Parent | admin-config/field-configuration (S-13) · assessment/step-1-assessment (DD-3) · bugfix/live-field-visibility (F-005) |
| Source | QA Platform Test Findings Log, F-012 (Mariagiulia Mariani, 2026-11-23) |
| Approval | back lead, 2026-11-24; Ángel and Yeck told in the findings thread the same day (Ángel may stop it) |
| Branch | `fix/F-012-latest-config-for-unstarted` from `origin/staging-center` |

## Symptom

"I cannot leave comments on ToC section. The ToC fields should be assessed."

## Root cause

Same as F-005. Version 8 (2026-11-23 14:45 Rome) made `toc.planned_result` Assessed for Policy change, but timeline 43 had opened at 14:40 and keeps version 7 (S-13), where it was not. Result 10159 shows it View only. The F-005 fix carries only Hidden / View only moves; a field never becomes Assessed there. ToC itself works: the view returns `toc.*` as `assessed` when configured, and the front puts the actions on its first card.

Also config, not code: `toc.entries` is View only for Policy change and Other output and Hidden for the other types; `contributors.science_programs` is Hidden for 8 types. To comment each contribution the Admin marks them Assessed.

## Expected

A Fields publication reaches every result **nobody has started**, in started timelines too. A result that already carries reviewer work (its assessment row exists: a validation, a comment or an end) keeps the version it started with, plus the F-005 Hidden / View only overlay.

## Acceptance criteria

1. With no assessment row, the view and the first write read the cycle's latest version; the first write pins it (DD-3 unchanged).
2. With an assessment row, nothing changes from F-005: the pinned version, Hidden / View only overlaid.
3. The timeline must still cover the result type (409 `ASSESSMENT_NO_FIELD_CONFIG` otherwise).
4. No contract or schema change.
5. Front (Yeck): the publish dialog copy says changes reach results nobody has started.

## Known limit

AI jobs are queued at load with the timeline's version (`ai-enqueue.service.ts`, `effectiveFor`). A field made AI input later gets no suggestion until a new load; nothing breaks.
