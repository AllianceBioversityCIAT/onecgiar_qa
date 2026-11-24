# Overview & Results: timeline cards, one timeline filter — 2026-10-09

## Done
- Overview: removed the "Load results into QA" button. `OvLoadDrawer`, `loadOpen` and `running` stay in place; nothing opens them now.
- Overview: replaced the timeline dropdown with timeline cards (`ov-timeline-cards.ts`): "All timelines", the official timeline and every non-closed sub-timeline. Selecting a card updates every number on the page (same `timelineId` signal as before).
- Overview: "Results in QA" no longer shows the Official / Sub-timelines boxes (the cards show those totals); it keeps the count per status.
- Overview: "1 sub-timeline is also live" selects that sub-timeline (with several live, it scrolls up to the cards). It used to open the dropdown.
- Overview: the header no longer shows the result count; the selected card shows it.
- Results: removed the timeline dropdown from the header. The "Timeline" filter next to the other filters stays.
- Results: the "Timeline" filter now lists the 3 open timelines, official first (Annual report 2026, July 2026 sub-timeline, September pilot). `BATCHES` is derived from `TIMELINES` in `results.mock.ts`.

## Tested
- `npx ng build`: passes. The initial bundle budget warning (551 kB vs 500 kB) was not checked against the base branch.
- Browser at 1440, 1024 and 390 px: cards in one row of 4 on wide screens and a 2×2 grid on narrow ones. Clicking the July card and the "1 sub-timeline is also live" link selects July; no console errors.
- Results at 1440 px: one "Timeline" filter; opened it and saw the 3 options in that order.

## Pending
- `ov-timeline-menu.ts` is no longer used; delete it or keep it.
- Results still has unused timeline picker state in `results-view.ts` (`timelineId`, `timelinePickerOptions`, `timelineById`).
- With many active sub-timelines the cards wrap into more rows; revisit if that happens.
- Not committed or pushed.
