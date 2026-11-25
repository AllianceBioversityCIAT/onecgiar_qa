# Tasks: show Auto-validated results in Results (F-010)

## T-1: List Auto-validated by default and count it apart — [x] PASS 2026-11-24

- **Scope:** `server/src/assessment/worklist.service.ts`, `worklist.store.ts` (doc), `worklist.controller.ts` (Swagger text), `models/worklist.model.ts` (`autoValidated`); tests in `worklist.service.spec.ts`, `test/assessment-worklist.e2e-spec.ts`, `test/assessment-round-two-scope.e2e-spec.ts`.
- **Falsifier:** old flag → F-010 test red (checked).

## T-2 (front, Yeck, optional)

- `client/src/app/core/api/assessment.models.ts` `WorklistCounters`: add `autoValidated`; the `total` comment no longer says "Auto-validated hidden". `results-view.ts` comment (line ~62) is out of date. Optionally show "incl. N auto-validated" next to the total.
