# Cycle: show the QA rounds in the timeline editor (2026-11-05)

Branch: `jp-design/mockup-completo` · Author: Juanpa (with Claude Code)

## Why
María Camila asked Juanpa how rounds are assigned in QA. Rounds are not set by hand: step 1 starts QA round 1, and each later step with "Loads results" on starts the next round (`roundsOf` in `cycle.mapper.ts`, the rule the server checks, FR-10 of the cycle-timelines spec). A new round is a fresh load of the results, so round 2 reviews what programs corrected in Reporting. The editor never said so: it showed only the "Load" switch.

## Done
- `timeline-drawer.ts` (Yeck's file, design and added lines only): an eyebrow label "QA round 1", "QA round 2"… above the step where each round starts, the same name as the round band on the Cycle card. It follows the switches as the admin turns them on or off. One line under the table explains the rule.
- New `rounds` computed in the drawer, built from the existing `roundsOf`. No existing logic changed.
- `docs/ux-ui/design.md` (Cycle row) mentions the round labels.

## Tested
- `ng build`: passes.
- `timeline-drawer.spec.ts`: 4 of 4 pass.
- Claude could not open Cycle with the design account (it needs the real API). Juanpa checked it in his Chrome with his CGIAR account on "P2-3903 QA test timeline": "QA round 1" above steps 1–2, "QA round 2" above step 3, and the line under the table. Desktop only.

## Pending
- Not verified: the mobile layout.
- Yeck is working on the Cycle screen on `feat/cycle-step1-loads` (P2-4064, 2026-11-05). His change in this file is in the imports and does not overlap these lines.
- Tell Yeck (his file).
