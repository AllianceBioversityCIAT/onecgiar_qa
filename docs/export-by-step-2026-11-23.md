# Export fields and comments by step (2026-11-23)

Branch: `jp-design/export-by-step` (from `staging-center`) · Author: Juanpa (with Claude Code) · Source: Jira P2-3914 "As a QA Admin, I want to export fields and comments by step" (pasted by Juanpa) and Yeck's note that the drawer was a prototype still to be adjusted to "fields and comments per step".

## Decision
- Fields are picked from a **checklist grouped by review section** (General information, Theory of change, Contributors and partners, Geographic location, Innovation development, Evidence), all checked at first, like the Reporting Tool's Result Center export. Each section's checkbox checks or clears the whole section and shows "mixed" when only part is checked; "Select all / Clear all" at the top with "N of M selected". Picked by Juanpa over keeping the "All fields" dropdown.
- A "Core" tag on each field was tried and dropped: 17 of 19 fields are core, so it was noise and cut the long names.

## Done (design only, mock data)
- New `pages/workspace/export/export-field-picker.ts` (checkbox look copied from `qa-multi-select`, `role="checkbox"`, `aria-checked` true/false/mixed). Two columns in the drawer, one on phones (container query).
- `export-comments-drawer.ts`:
  - Title "Export fields and comments", 720 px wide; filters two per row (one per row on phones); "QA stage" renamed "QA status".
  - "Include withdrawn comments" became "Include deleted comments" (criterion 7 wording).
  - Non-admins see "The file has only the results in your scope." (criterion 1; the server enforces it).
  - The summary counts results, fields and comments; Download is off with no fields or no results.
  - "Columns in the file" follows criteria 4 and 5: result (with current QA status), field (value, validation status green/grey), comment (nickname, date and time, step, deleted), program's response and its text, later steps.
  - The preset takes a `timelineName` for API timelines the mock list does not know.
- `cycle-view.ts/.html` (Yeck's): the timeline menu's "Export comments" (a TODO that did nothing) now opens the drawer with that timeline set. Only additions. The item is still hidden on API timelines: `cycle.logic.ts` marks it `soon` while the endpoint does not exist, and the menu leaves out `soon` items (Yeck's rule, review 2026-11-10). It shows up when that flag is turned off with the endpoint; not changed here.
- `docs/qa-context.md`: the export section follows the story; open question on the file's shape.

## Tested
- `ng build`: passes (only the old bundle size warning).
- `ng test` export + cycle: 154 of 154, including the new `export-field-picker.spec.ts` (all checked at first, mixed section, select/clear all, order kept).
- Seen by Claude in a test browser (design account, drawer mounted on the Overview only for the check, then removed) at 1440 and 390 px: two columns / one column, no horizontal scroll, long names wrap, unchecking fields updates "18 of 19 selected" and the summary.
- Shown to Juanpa in his Chrome the same way (drawer mounted on the Overview locally, not committed), since Cycle's menu hides it until the endpoint exists. Dark mode not checked.

## Pending
- Juanpa's review, then push and message Yeck.
- Juanda: the endpoint, and whether fields without comments get a row.
- Not wired: the "Export comments" button in a step's progress drawer (`progress-drawer.ts`, Yeck's) and in Results (the API version of Results has no row menu).
