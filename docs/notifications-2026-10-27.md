# Notifications for the QA Admin — provisional build (2026-10-27)

Branch: `jp-design/mockup-completo` · Author: Juanpa (with Claude Code) · Spec: `docs/specs/notifications/review-updates/`

**Status: provisional and not a priority** (team meeting, 2026-10-27). Juanpa will adjust it after the conversation with María Julia.

## Done
- **Bell in the top bar**, for admins only. A dot shows when something is unread.
  - From 640 px it opens a panel: the 8 newest, All / Unread with a grey count, "Mark all as read" and "View all notifications".
  - Below 640 px it is a link to the page.
- **Page `/notifications`** with timeline, Type, search and All / Unread. Rows are grouped Today · Yesterday · Earlier. Each row opens Results with the matching filter.
- **Data:** a mock (`notifications.mock.ts`) behind one store (`notifications-store.ts`). Every count in a sentence is computed from the Results mock, so it equals what Results shows.
- **Results** now re-reads its filters on every navigation to it, so a notification updates an open Results page. Juanpa confirmed this logic change in writing. It touches only the filter-reading lines; Yeck's TableSort lines in `results-view.ts` are untouched.
- **Shared UI kit:**
  - `qa-segmented` gained an optional grey count.
  - `qa-select` and `qa-multi-select` moved their grey text from `--text-muted` to `--text-4`, for AA contrast.
- **Shell and routes:** one line in `qa-shell.html` adds the bell; `qa-shell.ts` gains its import; `app.routes.ts` gains the admin-only `notifications` route.
- **Fixes from the browser check:**
  - On wide screens, the loading rows now have the same height as real rows.
  - The `?mock=` test states no longer stick after leaving them.

## Tested
- Unit tests: 66 in the notifications folder plus the Results, routes and UI-kit tests. The last full run was 262 tests before the two fixes; the 66 notifications tests pass after them. Build exit 0; initial bundle 606.04 kB (the budget warning was already there).
- In the browser at 390, 640, 768, 1024, 1280, 1366 and 1440 px (numbers in `execution.md`, T-7):
  - Panel: it opens with focus inside, and closes on an outside click, on the bell or on Escape, with focus back on the bell.
  - Dark mode works, inside the panel too.
  - Contrast ≥ 4.5:1 in light and dark.
  - No horizontal scroll at any width.
  - Each notification count matches Results.
  - The 7 Overview stage links still show 148, 200, 71, 180, 334, 40 and 357.

## Pending
- María Julia: event list and grouping, and the panel layout (spec OQ-1, OQ-2).
- Business: PRD § 5 keeps notifications out of v1.
- Juanda: a server module for real data, when this becomes a priority.
- Not verified:
  - A non-admin account in the browser (covered by a unit test).
  - AXE: no AXE tool is installed in `client/`.
- Tokens `--surface-4` (bell hover) and `--text-3` (bell icon) are not yet listed in the UX design's token section.
- Other kit parts still use `--text-muted`: `qa-menu`, `qa-tabs`, `qa-date-picker`, `qa-pagination` and `qa-badge`.
