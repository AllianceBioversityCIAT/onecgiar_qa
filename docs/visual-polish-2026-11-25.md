# Visual polish, direction A — 2026-11-25

Branch: `jp-design/visual-polish`, branched from `jp-design/scope-in-title`. Merge scope-in-title first.

## Why
Juanpa wants every main screen to read as professional, portfolio-grade work, not "made by AI" and not flat. An audit of the UI found typical AI-template tells:
- One teal/mint hue used for everything.
- Violet-tinted greys that clashed with the teal.
- White cards on a white page with no depth.
- 8 different corner radii.
- 147 fully rounded pills.
- Spaced UPPERCASE labels.
- Monospace numbers in teal.
- Rainbow charts (lilac, purple, blue and green together).

He chose **direction A** over B (a dark green sidebar):
- A warm grey canvas with white cards and a soft shadow.
- A neutral sidebar.
- Green only for actions, links, focus and the current step.

## What changed (class and token changes only; no logic)
- **Tokens** (`ui/tokens/qa-tokens.css`, light theme):
  - Green-tinted neutrals replace the violet ones.
  - Canvas `--bg` is #F4F5F4.
  - New `--shadow-card`.
  - Mint tints become sage (`--tint*`, `--band-*`, `--border-accent`, `--chart-1/2`).
  - `--qa-mono` now points to Manrope: numbers and dates use the app font, not a code font.
- **Shell:**
  - Canvas background for the content, top bar and sidebar.
  - The active nav item is a white raised row; the mint fill and left marker are gone.
  - Group labels are in sentence case.
  - The cycle block is plain information with no box, shadow or hover, closed by a line; as a white card it looked selectable. It has two lines: "2026 cycle ● Active", then "Main batch · Step 1 of 5 · closes 05 Dec". The time of day is cut in the template, and a short field in `active-cycle.ts` would be cleaner (for Yeck).
- **Cards:** 20 white cards get `shadow-(--shadow-card)`.
- **Labels:** 42 spaced-uppercase labels are now sentence case, 12px medium. This includes table headers, "Step 1", "QA round 1", "Result code" and the menu group labels.
- **Badges:**
  - 37 status pills became 6px-radius badges, 12px medium; `qa-badge` changed the same way.
  - Result, timeline and stage statuses are a neutral badge with a coloured dot (`.qa-dot` in `styles.css`, colour set through `--qa-dot`).
- **Selected states:** review sections and the Fields state chips use the nav's white raised row instead of mint. This replaces the 2026-11-12 tint decision for review sections; Juanpa can ask to bring it back.
- **Avatars:** neutral grey circle with dark initials.
- **Overview:**
  - Charts use one green scale from light to dark, where darker means further along (Round 1/2 bars, Progress by result type).
  - "Pending" segments are light grey.
  - Nested boxes became soft fills: the Round cards and the pace figures.
  - The "Quality assessed" strip is sage.
- **Cycle:** steps not yet open are soft grey fills; the current step is a raised white card.

## Tested
- `ng build`: green.
- `ng test` on `pages/workspace/**`, `ui/**` and `shell/**`: 47 files, 614 passed, 1 skipped.
- Playwright on port 4300 with the design account and the full API mock (`.playwright-mcp/mock-all.js`): Overview, Results, Review, Cycle, Fields and Assessors at 1440 px; no horizontal scroll.

## Pending / not verified
- Dark mode: checked by adding `.dark` by hand (the app has no switch); Results and Overview read well. Already there before this work: in dark the search field shows a lighter box inside its frame, and the logo has low contrast.
- Phone width (390 px): Results, Overview, Cycle and Review checked; no horizontal scroll.
- Not touched: `pages/sp/**` (the program's screens), the login, and the Overview copy ("Welcome back…" for non-admin roles; the "Now · 88%" labels and legend).
- The rule file `reglas/diseno-qa.md` still describes the old look (uppercase eyebrows, "Viewing X ⌄"). An update was proposed to Juanpa.
