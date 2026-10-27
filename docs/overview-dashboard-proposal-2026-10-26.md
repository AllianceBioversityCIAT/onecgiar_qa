# Overview as a dashboard — proposal (2026-10-26)

Mockup in Claude Design, project "QA Platform", file `Overview Dashboard Proposal.dc.html` (mock data, QA tokens).

## Idea
Each block answers one question the QA admin asks every day:
1. How is the cycle going? Rounds hero (unchanged).
2. What do I have to fix today? Needs your attention (current version, more compact).
3. Will we finish on time? Round 2 pace chart: assessed per day against the line needed to close on time, with the projection at the current pace.
4. How are the timelines? One card per live timeline: % ring, 5-step segmented bar, current step, closing date.
5. Where are results stuck? Stacked bar per result type, one segment per QA stage (same colors as the rounds). Replaces "Where the work is" by type.
6. Is the load balanced? Assessed vs still to assess per assessor, most pending first. Replaces "Where the work is" by assessor.

## Tested
Rendered at 1440 px; no console errors except a 404, probably the favicon (not checked).

## Pending
- Juanpa's review in Claude Design.
- The pace chart needs daily history from the back end (Juanda); everything else comes from data the app already has.
- Known gap in the mockup: the pace card leaves empty space under the chart because it stretches to the height of "Needs your attention".

## v2 (same day) — `Overview Dashboard Proposal v2.dc.html`
- Fixed titles: "Assessment pace" with a "Viewing Annual report 2026 · Round 2 ⌄" context line, instead of a question.
- Timelines: one list in one card (name and scope · steps with the current step and closing date · % reviewed). Shown with 5 timelines, with 1, and with 8 ("Show all 8 →").
- "Where results are stuck" replaced by "Progress by result type": 100% bars with 3 buckets (In Round 1, In Round 2, Quality assessed), least advanced first.
- Rendered at 1440 px and checked by screenshot.

## v3 (same day) — `Overview Dashboard Proposal v3.dc.html`
- Cards in a row share height (Needs attention = Assessment pace; Progress by result type = Assessor load). Measured: 585/585 and 383/383 px.
- Same data in every block: the 4 live timelines add up to the 1,330 results; every row names "timeline · step"; progress is always "done in this step".
- Assessment pace shows one timeline's open step (July 2026 sub-timeline · Step 1), with 4 numbers (still to do, needed per day, per day last 7 days, days left). The chart fills the card.
- Assessor load only counts timelines whose open step is the assessors' step, and its totals match the Timelines block (79 done, 178 left).
- Needs attention rows now point to real timeline steps (no "Round 2 closes", no steps that already closed).

## Open points
- Rounds (where each result is) and Steps (where each timeline's calendar is) are two vocabularies on the same page; with real data both must add up.
- The page header only names the official timeline; with several live timelines it could say "4 live timelines · next close 23 Jul".
- "Least advanced first" by % quality assessed favours result types that entered earlier.
- Assessment pace needs daily history from the back end (Juanda).
- Header updated (Juanpa approved): "4 live timelines · the next step closes in 4 days (23 Jul)". Checked in the render. The sidebar cycle card still names only the official timeline.

## In the app (same day) — branch `jp-design/mockup-completo`
- Overview now follows v3. Header: "N live timelines · the next step closes in X days (date)". Rounds hero unchanged.
- Row 1: Needs your attention (`ov-attention`) + Assessment pace (`ov-pace`, new): a timeline selector ("Viewing …"), 4 numbers and a line chart; behind-pace steps that close soonest come first.
- Timelines (`ov-timeline-lanes`, rewritten): one row per timeline, "Show all N" after 5. Clicking a row opens its stages pop-up.
- Row 3: Progress by result type (`ov-type-progress`, new, computed from the Results mock) + Assessor load (`ov-assessor-load`, new, mock).
- Removed "Where the work is" (`ov-work.ts`) and its mock data.
- Mock timelines changed to 4 live (989 + 216 + 84 + 41 = 1,330) plus the September pilot. The sidebar cycle card text now says "Step 4 of 5 · closes 23 Jul" (text only, in `shell/qa-shell.html`).
- Tested: `npx ng build` passes (the bundle-budget warning was already there; the overview and shell have no spec files). Checked in the browser at 390, 768, 1024, 1440 and 1920, in light and dark mode: no horizontal scroll; cards in a row share height (638/638 and 363/363 px at 1440; 746/746 at 1920).
- Pending: pace history and assessor assignments need the back end (TODO(api) in `overview.mock.ts`). On a phone the chart labels are small (they scale with the SVG). The "Load results" drawer can no longer be opened from the Overview (that was already the case before this change).

## Hero timeline picker (2026-10-26)

- Requested by Juanpa: filter the hero by "All timelines" or a single timeline.
- Done: an inline "Viewing All timelines ⌄" line at the top of the hero (`qa-select`, searchable, grouped Official / Sub-timelines, with counts). Picking a timeline recomputes the total, Round 1, Round 2 and Quality assessed; the line after the total turns into "Step X of N · closes DD Mon". Stage links pass `timeline=<id>` to Results.
- Mock: the Results mock only has the official and July timelines, so the overview takes 84 knowledge products and 41 SP03 results out of the official one for the KP fast track and SP03 late reporting (989 + 216 + 84 + 41 = 1,330).
- Tested: build passes; All → 1,330, July → 216, SP03 → 41 in the browser; no horizontal scroll at 390 and 768.
- Pending: Results does not know the KP and SP03 timelines yet, so their stage links open Results with all timelines. Dark mode not checked for this change.

### Follow-up: Results knows the four live timelines

- `results.mock.ts`: added "Knowledge products fast track" and "SP03 late reporting" to the timeline picker; their results (84 KPs, 41 SP03) are moved out of the official timeline (989 left). Steps and dates now match the Overview (Step 4 of 5 · 23 Jul, Step 1 of 5 · 23 Jul, Step 2 of 3 · 28 Jul, Step 1 of 4 · 02 Aug).
- The Overview now reads the timeline straight from each result (no split of its own).
- Tested in the browser: Overview hero and Results agree (all 1,330; official 989 with 110 pending; KP 84 with 12 pending; SP03 41).
- Still inconsistent: the Cycle screen mock (`cycle.mock.ts`) shows the official timeline with 1,114 results, step 5 closing 19 Jul, and only the July and September sub-timelines; `ui-gallery.ts` sample text says the same.

### Follow-up: Cycle tells the same story

- `cycle.mock.ts`: official timeline at 989 results, step 4 (third-party broker) open 06–23 Jul at 870 of 989, PPU 24 Jul – 07 Aug; July sub-timeline in step 1 (06–23 Jul, 74 of 216); added "Knowledge products fast track" (3 steps, step 2 open until 28 Jul) and "SP03 late reporting" (4 steps, step 1 open until 02 Aug); load targets match the Overview drawer.
- Sample text in `ui-gallery.ts` and a comment in `ov-stages.ts` updated to the same numbers.
- Tested: build passes; Cycle in the browser shows the 4 live timelines with the same steps, dates and progress as the Overview; no horizontal scroll at 1440.
- Removed the closed "May 2026 sub-timeline" from Cycle (QA keeps no history); the Closed tab now shows its empty state ("No closed sub-timelines yet"), checked in the browser.
- Not touched: `RESULT_TYPES` / `TOTAL_RESULTS` (1,114 submitted results, used only for the load estimate).

## Timelines block · options (2026-10-26)

- Feedback (Juanpa): each row has two horizontal bars and nothing says the dark green step is the open one.
- Claude Design, project QA Platform, file `Timelines Block Options.dc.html`:
  - Option A (recommended): one bar per timeline with its steps named under it; finished steps with a check, the open step outlined with "Now · 88%" and filled by its progress; on the right "870 of 989 done in step 4 · Closes 23 Jul · 4 days left"; legend at the bottom.
  - Option B: a shared calendar with a "Today" line; better suited to Cycle.
- Juanpa picked option A; it is in the app (`ov-timeline-lanes.ts`): one bar per timeline, steps named under it (`PHASE_SHORT`), the open step slightly wider, outlined, "Now · N%" and filled; right column "X of Y done in step N" + closing date; legend at the bottom. Narrow cards name only the open step.
- Tested: build passes; 390, 768 and 1440 with no horizontal scroll; light and dark.
- Known: when the open step is wide, a neighbour label can be cut ("2 · Programs corre…"); the full name shows on hover.
