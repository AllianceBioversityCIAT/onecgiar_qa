# Overview: plain subtitle and one Cycle link (2026-11-11)

Branch: `jp-design/mockup-completo` · Author: Juanpa (with Claude Code)

## Why
- The line under "Welcome back, Juan Pablo" ("4 live timelines · the next step closes in 4 days (23 Jul)") came from Overview's mock data. The sidebar cycle card, on real qatest data since Yeck's change of 2026-11-10, said "2026 cycle · Main batch · All 5 steps completed". The two looked like the same status and disagreed. With real data they would still overlap: the sidebar speaks of the main batch, the line of every live timeline. "Progress by timeline" right below already shows each timeline with its closing date.
- Two links went to Cycle: "Open Cycle" on Progress by timeline and "See the full cycle" on the results card.

## Done
- `overview-view.html`: the status line became a short, warm subtitle that covers the whole page (Juanpa wanted it to follow the greeting, not read like a page description): "Here’s how QA is going today." The `context` computed that built the old line is gone from `overview-view.ts`.
- `ov-cycle-hero.ts`: "See the full cycle" removed, with its now unused `QaButtonImports`. "Open Cycle" on Progress by timeline is the page's only Cycle link: timelines are what Cycle holds, and the results card's counts open Results.
- `docs/ux-ui/design.md` (Overview row) has the new header and the single link.

## Tested
- `ng build`: passes (only the bundle size warning that was already there).
- Not verified in the browser by Claude. The design account is now signed out right after signing in, most likely because the sidebar cycle card calls the real API since 2026-11-10. Juanpa checks it in his Chrome with his CGIAR account.

## Pending
- Not verified: the mobile layout.
- Pushed to the design branch on 2026-11-11.
