# Overview: Round 1 and Round 2 side by side (2026-10-16)

## What changed

- The Overview hero no longer shows a single status bar. It shows two cards side by side, which stack on narrow screens:
  - **Round 1** (assessors): Pending · In review · Assessed by 1 assessor · Assessed by 2 assessors.
  - **Round 2** (lead assessors, third-party brokers and PPU): Pending · Assessed.
  - Below both cards, a green **Quality assessed** strip. It is the only place that term is used.
- Each round has its own bar. Its shades go from grey (not started) to the round's full color (assessed): indigo for Round 1, blue for Round 2. Green is kept for the final state.
- Every row links to `/results?stage=<stage>`. Results reads `stage`, filters by it and shows a removable "QA stage" chip.
- Mock: `qaStage()` in `results/results.mock.ts` derives the stage from status + round. The Overview counts come from the same `RESULTS`, so both screens always match.

## Tested

- `npx ng build`: green. The `bundle initial` budget warning was already there before this change (580.9 kB before, 581.5 kB after).
- In the browser (Playwright, logged in against qatest):
  - Screenshots at 1440 / 1024 / 768 / 390, with no horizontal scroll.
  - All 7 links open Results with the same count as the Overview (148, 200, 71, 180, 334, 40, 357).

## Pending

- API: the stage, and how many assessors have finished round 1 (`TODO(api)`).
- Business to confirm: where "Awaiting response" and "Answered" fall (see `docs/ideas.md`, 2026-10-16).
- The old `STATUS_COUNTS` in `overview/overview.mock.ts` is no longer used by the hero.

## Update: "Assessment outcomes" removed (2026-10-16)

- At Juanpa's request, the "Assessment outcomes" card no longer appears in the Overview. Its use in `overview-view.html` / `overview-view.ts` was removed.
- Tested: `npx ng build` green. In the browser the Overview ends at "Where the work is" and the card is gone.
- Pending: none (the unused files were deleted afterwards, see below).

## Update: dead code removed and Timelines card (2026-10-16)

- With Juanpa's OK, deleted `overview/ov-outcomes.ts` and `OUTCOMES` from `overview.mock.ts`. Nothing else used them.
- "Timelines": the title and subtitle now sit inside the card, like every other Overview section. Rows are separated by the same line as "Stage completion", with no line between the title and the first row.
- Tested: `npx ng build` green. Screenshots at 1440 and 390, with no horizontal scroll.
