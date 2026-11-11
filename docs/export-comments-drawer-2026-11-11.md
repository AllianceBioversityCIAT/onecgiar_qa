# Export comments drawer (2026-11-11)

Branch: `jp-design/mockup-completo` · Author: Juanpa (with Claude Code) · Source: Yeck's list, Juanda's answer on P2-3914 (Slack, 2026-11-11)

## Why
The three "Export comments" buttons did nothing. Juanda defined the export: the server builds the .xlsx and checks each role's scope; the front has the drawer and the download.

## Done
- New `pages/workspace/export/export-comments-drawer.ts` (480px drawer, mock data):
  - Filters: timeline, step, science programs, result types, QA stage, fields, and an "Include withdrawn comments" switch (off).
  - Opened from one result, that result is fixed (code and title, no remove): only fields and withdrawn comments are chosen. Juanpa, 2026-11-11: a removable chip that turned the drawer into another export was confusing. The full filters show when it opens from Cycle (timeline or step).
  - A live estimate ("About N comments from M results") and a "Columns in the file" list (result, comment, after the comment). The later columns come out empty until the lead, TPB and PPU steps exist.
  - "Download .xlsx" is disabled when nothing matches. TODO(api): call the P2-3914 endpoint with the filters.
- `results-view`: "Export comments" in a result's menu opens the drawer scoped to that result.
- Not wired in Cycle on purpose: Yeck is changing `cycle-view.ts` these days, and live timelines show "Export comments" as "Coming soon" until the endpoint exists. The drawer takes `preset: { timelineId }` for the timeline menu and `{ step }` for the step's progress drawer.
- No "Download" button in the Results header: Juanpa removed it on 2026-10-08 (421e334).
- `docs/qa-context.md`: Juanda's decisions on the export, plus an open question on Program/PPU.

## Tested
- `ng build`: passes (only the bundle size warning that was already there).
- Playwright with the design account (qatest API blocked in the test browser):
  - 1440px: opened from QA-2026-0841, the drawer shows the fixed result with its title, Fields, the switch and "About 5 comments from 1 result".
  - Full filters (checked before the result was fixed): choosing "July 2026 sub-timeline" and turning on withdrawn comments updates the estimate.
  - 390px: no horizontal scroll.
- Fixed while testing: Timeline and Step side by side overflowed the drawer; they are now one per row.

## Pending
- Juanpa's review, then push.
- Yeck: wire the two Cycle buttons when the endpoint exists.
- Open: can Program and PPU download? Juanda to confirm with Ángel.
- Open: does the QA admin need an "Export comments" button in the Results header (with the page's filters)? Not added; ask Santi / María Julia if Cycle's timeline and step exports are not enough.
- Not in the December batch (Juanda).
