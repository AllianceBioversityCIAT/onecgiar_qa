# Overview by role: adjustments after the review with Ángel (2026-11-17)

Branch: `jp-design/mockup-completo` · Author: Juanpa (with Claude Code) · Source: Juanpa's meeting with Ángel on the Overview by role (AI-written meeting summary shared by Juanpa)

## What already matched
- Sidebar: Cycle, Fields and Assessors show only to admins (`shell/qa-shell.ts`, `Permission.ADMIN_ACCESS`, Yeck's code).
- Assessor: Your work (Pending / In review / Answered by the program; Pending opens Results filtered), Your pace, Progress by result type, What happened to your comments.
- TPB: Your work, Next to decide, Your decisions, Progress by timeline.

## Done (design only, mock data, Juanpa's files)
1. **Assessor, "Most discussed fields"**: the fields where the assessor left the most comments (`MY_TOP_FIELDS`). It sits next to "What happened to your comments". "Progress by result type" now takes the full width, since each assessor works on only a few types.
2. **PPU, Reporting Tool status**: each change in "Next changes to apply" says whether the program already updated it in the Reporting Tool. The updated ones come first and have a "Mark when done" button (same label as in Review). Your work counts *Updated in the Reporting Tool* / *Not updated yet* / *Done*, and marking one done updates the counts and the list (preview only). `PPU_QUEUE` is now the list of changes; `TODO(api)`: the Reporting → QA sync of the corrected field.
3. `ov-ranked.ts`: the label, bar and count have explicit grid cells. In a narrow card, the count used to take the label's place and the label was cut to three letters.

## Checked with the back
- Juanda (back lead) watched the video of the Overview for each role and said it all looks fine, with no changes (2026-11-19, via Juanpa).

## Not done: waiting for Yeck and Santi
- **Lead assessor**: Ángel's rules (only core fields; closes or escalates; result becomes Quality assessed by itself; can edit other assessors' comments) contradict Santi's (every commented field; highlight with an instruction; closes nothing), which Review already follows. Ángel also listed "Next to decide" and "Escalated cases" for the lead's Overview. Nothing changed until it is settled.
- **KPs**: straight into round 2 (Ángel) or step 1 (Juanda, 2026-11-04).
- **One person, two roles** in different result types (Ángel): the Overview shows one role at a time today.
- Both are in `docs/qa-context.md` § Open questions.

## Tested
- `ng build`: passes (only the bundle size warning that was already there). The Overview has no unit tests.
- Seen by Claude in the browser (design account, API requests blocked): assessor at 1440 px and 375 px, lead at 1440 px (shared ranked card still fine), PPU at 1440 px and 375 px; "Mark when done" moves 2/4/0 to 1/4/1 and announces it to screen readers; no horizontal scroll on mobile.
- Not verified: dark mode, 768 and 1024 px.
- Known mock gap (already there before): the PPU and lead steps show work although they open on 24 and 29 Jul in the mock.
