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

- `ov-timeline-cards.ts`, `ov-step-card.ts` and `ov-results-in-qa.ts` are no longer used. Delete them only after Juanpa confirms.
- The "See the full cycle" link (to `/cycle`) was in the removed step card. It may need a new home.
- Dark mode not checked.
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
