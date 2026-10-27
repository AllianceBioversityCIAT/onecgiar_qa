# Overview header aligned with the PRMS home — 2026-10-23

## Done
- Page title is now "Welcome back, <first name>" (from the signed-in profile; plain "Welcome back" when there is no first name). The old subtitle is gone.
- Context line under the title, as on the PRMS home: "Annual report 2026 · Step 5 of 5 · closes **today**" (only the days / "today" in bold).
- "Needs attention" is now "Needs your attention" with a gray counter. Tried the title outside the card (PRMS style); kept it inside, it reads better in QA.
- The cycle hero no longer repeats the current step or the cycle name: it shows "2 live timelines" and "See the full cycle".

## Tested
- Checked in the browser against qatest (design user) at 1440 and 390: no horizontal scroll, header on one line.
- `npx ng build` passes (the existing 500 kB initial budget warning remains).

## Pending
- Not checked at 768 / 1024 or in dark mode.
- The sidebar item is still called "Overview" on purpose.

## Update — cycle hero total
- The total now reads as one sentence: "1,330 **results in QA**, from 2 live timelines", with "See the full cycle" on the same line (it wraps under it on narrow cards). A big number with a small gray label stacked under it read as a generic KPI tile.
