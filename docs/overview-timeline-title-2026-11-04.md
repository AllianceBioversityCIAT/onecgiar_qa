# Overview: "Progress by timeline" card title, no count (2026-11-04)

Branch: `jp-design/mockup-completo` · Author: Juanpa (with Claude Code)

## Done
- The card on Overview is now called "Progress by timeline" (was "Timeline progress"). Juanpa wanted the title to read as many timelines; this wording matches the "Progress by result type" card on the same page. Code comments that named the card were renamed too.
- The card no longer shows a count next to its title ("5", or "1 of 5" when filters hide some timelines). Juanpa asked to remove it.
- `ov-timeline-lanes.ts`: the count and its now unused `total` input were removed. `overview-view.html` stops passing `[total]`.
- `docs/ux-ui/design.md` (Overview row) has the new title and says there is no count next to it.

## Tested
- `ng build`: passes (only the bundle size warning that was already there).
- In the browser at desktop width with the design account: the card title reads "Progress by timeline" with no number.
- The same check showed the greeting works: "Welcome back, Design". Juanpa's own copy shows only "Welcome back", most likely because his qatest user has no first name saved (not verified).

## Pending
- Not verified: the mobile layout.
- Nothing committed or pushed yet.
