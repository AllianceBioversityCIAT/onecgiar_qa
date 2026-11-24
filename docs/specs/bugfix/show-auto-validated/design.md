# Design: show Auto-validated results in Results (F-010)

| Field | Value |
|---|---|
| Depth | Lite |
| Approved | back lead, 2026-11-24 |

| # | Decision | Why |
|---|---|---|
| D1 | `hideAutoValidated = statuses.length > 0 && !statuses.includes('auto_validated')` in `WorklistService.list` | No filter shows everything in scope; a filter behaves as a filter |
| D2 | `countByStatus` always runs with `hideAutoValidated: false` | Counters stay stable whatever the filter, and `total` matches the unfiltered list |
| D3 | `counters.autoValidated` (additive) | The front can say "incl. N auto-validated"; `pending` / `finished` keep their meaning, so progress ("done of total") can subtract them |

## Tests

- `worklist.service.spec.ts`: Admin default list includes Auto-validated, a `pending` filter leaves it out, `not_in_qa` never shows; F-010 (10 pending + 3 auto: default 13 rows, auto filter 3, pending filter 10, counters `{10, 0, 13, 3}` in all three).
- Falsifier: the old flag (`!statuses.includes('auto_validated')`) → F-010 test red.
- Counter shapes updated in unit and e2e (`autoValidated: 0`).
- Verification: unit 4278 / 6 skipped · e2e 1337 · lint 0 · build ok.
