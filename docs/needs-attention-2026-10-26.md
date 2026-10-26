# Overview · Needs your attention — 2026-10-26

## Goal (approved by Juanpa)
The section lists only what the admin can fix in QA before a stage closes. A row needs:
1. an action the admin can take in QA,
2. a deadline or a consequence,
3. a link that lands where the fix is made.

Rows she can only watch go to "Where the work is".

## Done
- Two groups, both gray and told apart by a leading icon (ban, clock): **Won't be reviewed** (no active assessor, assessor never signed in) and **At risk before the stage closes** (progress lagging the stage clock).
- Each row: problem (subject in bold); below it, in gray, "Timeline · Stage · Closes 23 Jul (4 days left)"; one action on the right (`Open Assessors` to assign or reassign, `Open Cycle` to move a stage date).
- Rows sorted by deadline, then by results affected.
- Removed "Waiting" (it linked to `?status=Awaiting response`, a status Results no longer uses) and "Show progress" (it only scrolled to "Where the work is").
- Wide cards (≥ 72rem) put the groups side by side; narrower cards stack them.

## Tested
- `npx ng build` passes (the bundle-budget warning was already there).
- Checked in the browser at 390, 768, 1024, 1440 and 1920, light and dark. No horizontal scroll.

## Pending
- Business: what happens to unanswered results when the correction window closes. "Waiting" comes back only if that needs an admin action.
- Dev: deep links (`/assessors?type=…`, `/cycle?timeline=…`); both views ignore query params today. Cycle has commits from Yeck, so it was not touched.
- Dev: rows are mock data (`overview.mock.ts`, `ATTENTION`); they need to come from assignments, sign-ins and stage progress.
- With the emergency design user, `/assessors` still signs you out (401, `core/auth`).

## Change after review (same day)
- Juanpa did not understand "In 4 days" in its own column, and the extra column made the list look like a table. The deadline now goes at the end of the gray line, "Closes 23 Jul (4 days left)", and is kept on one line. The row has two columns again: text and action.
- Juanpa did not want "Won't be reviewed" in red while the other group was gray. Both labels are gray now, with a 14 px icon before each one: a ban sign for "Won't be reviewed" and a clock for "At risk before the stage closes". Checked at 1440, light and dark.
