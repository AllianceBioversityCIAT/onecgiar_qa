# Overview: hero + timeline lanes (2026-10-13)

Branch: `jp-design/mockup-completo` · Author: Juanpa (with Claude Code)

## Why

The four timeline cards at the top of Overview worked as a filter, but nothing showed that they were tabs or that the rest of the page depended on them. The section also looked flat.

## What changed

- **Removed the timeline filter.** Every number on the page is now for the whole cycle (all open timelines).
- **New `ov-cycle-hero.ts`:** a tinted block with the cycle total, the % quality assessed, the official timeline's current step, and a stacked bar that splits all results by status. Each status links to Results filtered by that status (same as the old "Results in QA" card).
- **New `ov-timeline-lanes.ts`:** one row per open timeline (official first) with its status, results, a 5-step tracker, the current step with "closes / opens" text, and the open step's progress.
- "By timeline" rows in *Where the work is* now scroll to that timeline's lane and highlight it for 2 s (they used to switch the filter).
- `overview-view.ts`: removed `timelineId`, `selected`, `resultsInQa`, `stepCard`, `subsLiveText`, `openSubs`; `total` is now a constant.

## Tested

- `npx ng build`: passes (only the existing initial-bundle budget warning).
- Browser at 390, 768, 1024 and 1440 px: no horizontal scroll; lane text wraps on mobile.
- "By timeline" → click a timeline → its lane gets highlighted.

## Pending

- `ov-timeline-cards.ts`, `ov-step-card.ts` and `ov-results-in-qa.ts` were deleted (unused, confirmed by Juanpa).
- "See the full cycle" (to `/cycle`) now lives in the top block, under the current step (link button).
- Dark mode and mobile checked at the end of the day (see below).
- Angular CLI MCP was not loaded in this session (opened from `C:\brain`); used the official `angular-developer` skill instead.

## Second pass, reverted (same day)

A second pass removed the cards, caps labels, mono numbers and pills, and turned the top into a one-sentence lead with a single-color status ramp. Juanpa asked to go back to the first version, so it was reverted. A copy of the reverted files is outside the repo, in the session scratchpad (`overview-v2-backup`).

## Third pass: polish inside the existing structure (hero only, as a trial)

Juanpa explained why the second pass was reverted: sections were left floating without their card, and the large lead sentence made the Overview header differ from every other screen (all screens use an fs-26 title + short subtitle). It also felt less intuitive.

New approach: keep the cards and the standard header, and polish details inside them. Trial on the top block only:

- Flat tinted background instead of the gradient; no pulsing dot.
- Sentence-case label ("2026 cycle, 2 live timelines") instead of tracked all-caps.
- Numbers in the app font (tabular figures) instead of monospace.
- No "·" separators ("Step 5 of 5: QA platform open for PPU, closes today"; "quality assessed (357 results)").

Tested: `npx ng build` passes; browser at 1440 and 390 px.
Pending: Juanpa's OK before applying the same polish to Timelines, Stage completion, Needs attention, Where the work is and Assessment outcomes.

## Final checks (end of day)

- Overview, Cycle, Results, Review, Assessors and Fields at 390 and 768 px: no horizontal scroll; every `qaBtn` is at least 40px tall on phones.
- Dark mode at 1440 px on the same 6 screens: filled buttons pass AA contrast (Approve and Finish 7.8:1, Use as comment 4.6:1).
- `npx ng build`: passes. The initial bundle warning (551 kB vs 500 kB) predates today (553 kB on 2026-10-09); its cause and fix are in `docs/ideas.md` for Yeck.

## Top block: alignment and calmer surface (same day, after review)

Juanpa said "1,330" and "27%" were not aligned, and the card color could be calmer and without an outline.

- Two rows now share the same left and right edges: a context row (cycle, current step and "See the full cycle") and a figures row where "1,330 results in QA" and "27% quality assessed" sit on one baseline at the same size.
- Background is the neutral `--surface-3`, with no border.
- Checked at 1440 px (bottom edges of both figures match) and at 390 px.
