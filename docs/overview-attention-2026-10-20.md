# Overview "Needs attention": less generic — 2026-10-20

Branch: `jp-design/mockup-completo`

## Done
- Title count: plain muted number instead of a red/amber pill.
- Subtitle: "Issues in this cycle that need someone to act." (replaces "Everything that will not resolve on its own.").
- Group headings: no icons. Only Coverage keeps a color (`--danger`) because its results will not be reviewed at all; Pace and Waiting are neutral. The count sits next to the name.
- Rows: only the subject is bold (Assessor LM, SP09, Capacity sharing for development, Assessor DD); numbers are plain. No hover background, since the row itself is not clickable.
- Actions: three labels, "Open Assessors", "Show progress" and "View results" (mock data in `overview.mock.ts`).

## Tested
- Browser at 1440 (light and dark) and 390.
- `npx ng build` passes (only the existing bundle budget warning).

## Update (same day)
- Group headings use the sidebar eyebrow style (11px, uppercase, letter-spaced, muted); Coverage stays red. More space between groups (24px).
- No divider between a group heading and its first row; lines only separate rows.

## Where the work is (same rule)
- Pace column: no icons. Only "At risk" keeps a color (`--danger`, semibold); "Behind" is dark grey and "On track" light grey.
- "At risk" tab: no orange text; its count is muted like other counts.
- Completion %: medium weight instead of bold.
- Checked at 1440 (By result type, At risk) and 390. `npx ng build` passes.
