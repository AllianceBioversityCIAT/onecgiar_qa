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
