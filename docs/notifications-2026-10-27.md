# Notifications for the QA Admin — provisional build (2026-10-27)

Branch: `jp-design/mockup-completo` · Author: Juanpa (with Claude Code) · Spec: `docs/specs/notifications/review-updates/`

**Status: provisional and not a priority** (team meeting, 2026-10-27). Juanpa will adjust it after the conversation with María Julia.

## Done
- **Bell in the top bar**, for admins only. A dot shows when something is unread. It opens the page directly at every width. A panel was built first and removed the same day at Juanpa's request.
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

## Update 2026-10-29 — one list, adapted to QA
- **Why:** the 2026-10-28 version copied PRMS whole (three tabs, a timeline picker, Type, Science program and search). In QA a single admin gets 10 to 15 notifications. The tabs only added clicks, and the design rule says to show things together rather than hide them behind selectors. The notifications María Julia asked for (meeting, 2026-10-27) are almost all actions: a step finished for a batch, and slow programs.
- **Done:**
  - One list, newest first, in day groups. A row that needs action carries its own button and "Not now".
  - Removed: the tabs, "Viewing <timeline>", Type, Science program, search and the chips.
  - "Mark all as read" moved into the page header.
  - Removed the types that repeat Overview counts, "Stage" and "Quality assessed" (4 entries). The mock now has 10 entries: 6 that need action and 4 updates.
- **Tested:** 55 notifications tests pass (the tab and filter tests were replaced by "one list, no tabs, no filters" and "buttons only on action rows"). eslint and tsc are clean. Checked in the browser at 1440 and 375 px, with no horizontal scroll.
- **Then, the same day (Juanpa):**
  - Only the types María Julia asked for remain: "Step complete" (×3: assessors, lead assessor, third-party broker) and "Slow program" (×2). The mock has 5 entries, 2 of them unread, all with a button.
  - At risk, Escalation, Program response and Load were removed, along with the unused `delta` field. They are kept as ideas in `docs/ideas.md`.
  - "Mark all as read" was removed for now. The store still has `markAllRead`.
  - Tested: 49 notifications tests pass (the store and bell counts went from 4 unread to 2). eslint and tsc are clean. Checked in the browser at desktop width.
- **Not changed (to decide):** the tinted icons and the type pill on each row; the bell still counts unread notifications.

## Update 2026-10-28 — PRMS pattern adapted to QA (superseded on 2026-10-29)
- **Done:** the page follows the PRMS notifications page, adapted to QA (Juanpa, from a PRMS screenshot and the 2026-10-27 meeting).
  - Tabs All · Needs your action · For your information, each with its count under the current filters.
  - Filters: Viewing <timeline>, search, Type (only the current tab's types), Science program; chips with Clear all; "Mark all as read".
  - Rows: unread dot, tinted icon, one sentence, meta line (type · Main batch / Complementary batch · step · time).
  - Needs your action: step complete ("Open next step" → Cycle), slow program ("View results"), at risk; each with "Not now". Any button marks the row read.
  - Removed: the Third-party broker, PPU and Waiting types, the unused `panel` variant and the All / Unread control.
  - Timeline kinds read "Main batch" / "Complementary batches" (O-8 of `overview-feedback-2026-10-27.md`).
- **Tested:** 85 unit tests in notifications, overview and results pass; eslint clean; `ng build` exit 0 (initial bundle 605.96 kB, budget warning already there). Browser check at 1440 and 390 px and in dark mode: no horizontal scroll; every count matches Results.
- **Top bar, as in PRMS:** the bell now reads "Notifications" with the unread count in a pill from 768 px; below that only the bell, with the pill on its corner. Tested: 79 notifications tests pass, eslint clean; checked at 1440 and 375 px; pill contrast 5.5:1 light (white on #0F766E) and about 8:1 dark; no horizontal scroll.
- **Not verified:** "Open next step" with a real admin (the design account is signed out by Cycle's API); AXE (no tool in `client/`).

## Pending
- María Julia: event list and grouping (spec OQ-1, OQ-2).
- Business: PRD § 5 keeps notifications out of v1.
- Juanda: a server module for real data, when this becomes a priority.
- Not verified:
  - A non-admin account in the browser (covered by a unit test).
  - AXE: no AXE tool is installed in `client/`.
- Tokens `--surface-4` (bell hover) and `--text-3` (bell icon) are not yet listed in the UX design's token section.
- Other kit parts still use `--text-muted`: `qa-menu`, `qa-tabs`, `qa-date-picker`, `qa-pagination` and `qa-badge`.

## Update 2026-10-29 — top bar, as in PRMS
- On `/notifications` the bell takes the sidebar's selected look: light green `--tint-2` background with green `--accent` text and icon. PRMS does the same in purple. Contrast is about 6.5:1 in light and 7:1 in dark mode.
- A thin vertical line (`--border-strong`, 24 px) now separates the top-bar actions from the user menu. It shows only for admins and only from 768 px. This is a one-line addition in `qa-shell.html`.
- Tested: 5 bell tests pass and eslint is clean. Checked at 1440 px in light and dark mode, both on Notifications and on the Overview.
