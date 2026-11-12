# Overview by role (2026-11-11)

Branch: `jp-design/mockup-completo` · Author: Juanpa (with Claude Code) · Source: Yeck's list (Overview by role)

## Why
Overview was only the QA admin's dashboard. Each reviewing role needs to see, when it signs in, what needs it, by when, and a few figures of its own. Program is left out: it answers inside the Reporting Tool embed (Santi via Yeck, 2026-11-11).

## Done (mock data, `overview-roles.mock.ts`)
- "Viewing as" in the page header (same inline menu as Review; `?as=assessor|lead|tpb|ppu`, no `as` = QA admin). TODO(api): the role comes from the user's assignments.
- **QA admin:** unchanged (María Julia's dashboard). Its subtitle stays "Here’s how QA is going today."; the other roles read "Here’s what needs you today."
- Every reviewing role: **Your work** (new `ov-your-work.ts`), then its own blocks, then Progress by timeline without "Open Cycle" (Cycle is an admin screen).
  - Your work gives the count, the step and when it closes or opens (red when 3 days or less), progress when the role has a "done", the breakdown rows, and one button to start working.
- **Assessor (M. Chen in the mock):**
  - Your work counts the open assessors' step, from the same series as Your pace, so both agree.
  - **Your pace** (the existing pace chart for their share, without the assessor menu).
  - **Progress by result type** for their results.
  - **What happened to your comments** (new `ov-split.ts`): accepted, rejected, no answer yet. Neutral colors, as information, not a grade.
- **Lead assessor:**
  - Comments the programs rejected (none marked yet: the lead's step opens 29 Jul in the mock).
  - **Rejections by program** and **Most discussed fields** (new `ov-ranked.ts`).
- **TPB:**
  - Highlighted fields to decide, with progress.
  - **Next to decide** (new `ov-next-items.ts`): opens the review with `?as=tpb`.
  - **Your decisions** (split).
- **PPU:**
  - Changes to apply (the TPB's "Required changes"; the step opens 24 Jul).
  - **Next changes to apply** (list).
- Small changes in existing blocks:
  - `ov-pace.ts`: optional title; no assessor menu when no options are given.
  - `ov-timeline-lanes.ts`: `cycleLink` input.
  - `overview-view.ts`: pace and type rows moved to reusable functions.

## Tested
- `ng build`: passes (only the bundle size warning that was already there).
- Playwright with the design account (qatest API blocked in the test browser, so the sidebar shows "We could not reach the QA service"):
  - The four roles and the admin at 1440 px, plus the assessor at 390 px. No horizontal scroll, and the admin view is unchanged.
- Fixed while testing:
  - Your work and Your pace disagreed (62 vs 30); both now come from the same numbers.
  - The lead row repeated the total.
  - The ranked list had no space between program code and name.
  - The lead and PPU showed work done before their step opens.
  - On phones "Viewing as" now wraps under the greeting.

## Pending
- Juanpa's review, then push.
- Not verified: 768 and 1024 px, dark mode.
- `docs/ux-ui/design.md` (Overview row) gets updated once approved.
- API: per-user counts (assignments), comment outcomes, lead/TPB/PPU steps (not built yet: Juanda, 2026-11-11).
