# Traceability (P2-3915): result history, design (2026-11-21)

Branch: `jp-design/traceability` (from `staging-center`) · Author: Juanpa (with Claude Code) · Source: Jira P2-3915 (pasted by Juanpa), Yeck's ask on Slack 2026-11-19 ("the only story with no design yet")

## Done (design only, sample data)
- **History button** in the Review title row (every role that can open the result, AC 6). It opens a 720 px drawer, full width on phones.
- **Activity tab** (AC 1, 2, 4, 5): every event of the result, grouped by step (Assessors → Programs correct → Lead assessor → Third-party broker → PPU), oldest first.
  - Each entry says who (name and nickname), the role, when and on which field.
  - Comments show the field value they referred to ("Value then"). The program's answers, the clarifications, and the Lead, TPB and PPU decisions show their text.
  - Status changes show from → to. The loads say the timeline and step.
  - A comment deleted by the lead assessor stays, with a "Deleted" tag, who deleted it and when; the deletion is also its own event in the Lead step.
  - Filter: All · Comments · Decisions · Status, with counts.
  - Read only: no action in the drawer.
- **Data at load tab** (AC 3): each field as it was loaded in step 1 and in step 3, side by side (stacked on phones). Changed fields carry a "Changed" tag and an accent edge; filter All fields · Changed.
- Files: `review/history/review-history.ts` (button + drawer), `review/history/result-history.mock.ts` (sample data, `TODO(api)`). In Yeck's `review-view.ts` / `.html` only one import and one `<qa-review-history>` line were added.

## Configuration log (AC 7, 8), same day
- New page **Activity log** (`/activity-log`, QA admins only, `Permission.ADMIN_ACCESS`), last item of Administration in the sidebar.
- Filters follow the Results bar: "Type of change" (Timelines · Field configuration · Users), "Changed by" (searchable) and "Date" (Any time · Today · Last 7 days · Last 30 days); chips with × and Clear all. Empty state with Clear filters.
- Table, newest first: When · Changed by (name and nickname) · What changed (type tag, property, target) · Before and after ("Not set" when it did not exist, "Removed" in red when it no longer does). Below 760 px of card width each row stacks as a card with who and when under the change.
- Files: `pages/workspace/activity-log/activity-log-view.ts`, `activity-log.mock.ts` (`TODO(api)`; the date filter uses the sample's fixed "today", 30 Jul 2026). Added (nothing removed): one route in `app.routes.ts`, one item in `shell/qa-shell.ts`.
- Tested: `ng build` passes; shell and routes specs 15 of 15. Seen at 1440, 768 and 390 px, no horizontal scroll; Timelines → 5 rows, + Last 7 days → 3, Clear all → 14.
- Pagination with the kit's `qa-pagination` ("Showing 1–25 of 41", rows per page, pages; "Page 1 of 2" on phones). It goes back to page 1 when a filter changes (`linkedSignal`). The sample now has 41 changes (27 older set-up changes in June, generated). Seen: page 2 shows 26–41; Users filter → 1–16 of 16; no horizontal scroll at 390 px.

## Not done yet
- "History" in the "…" menu of a result in Results (Yeck's table).
- API: the history route does not exist yet. P2-3912 already stores comment events and who deleted a comment (`comment_events`, `deleted_by`, `deleted_at`).
- Lead assessor wording follows the P2-3912 story (agree with the program / escalate to TPB), which Ángel still has to confirm.

## Tested
- `ng build`: passes. `review-view.spec.ts`: 69 of 69 pass.
- Seen by Claude in the browser (design account, assessment API answered with a sample view): Review at 1440 and 390 px; drawer Activity and Data at load at 1440 and 390 px; filters (Decisions 7 entries in 4 steps, Status 8); no horizontal scroll in the drawer on phones.
- Not verified: 768 px, dark mode, screen reader pass.
