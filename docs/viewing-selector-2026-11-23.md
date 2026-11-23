# Timeline context card: Results, Overview and Fields (2026-11-23)

Branch: `jp-design/viewing-selector` (from `staging-center`) · Author: Juanpa (with Claude Code) · Source: Yeck, Slack 2026-11-23, after the demo with María Julia: in Results the "Viewing <timeline> ⌄" line was hard to see although it decides the whole page.

## Decision
- First try: the value as a bordered chip. Juanpa did not like it: the filters depend on the timeline (in Results a timeline switch drops the programs and types it does not offer, `results-view.ts` `dropUnoffered`), so the timeline should lead, and the chip left a lone row with empty space at the right.
- Chosen (Juanpa, 2026-11-23): a **context card** at the top of the page. The timeline is big, with its key facts under it and the total at the right; the filters that depend on it sit inside, under a hairline. Same card in Results, Overview and Fields.

- Second round (Juanpa, same day): the white card with border and corners looked like one more chart of the Overview, not like what decides the page. Now it is a **grey band from edge to edge** that continues the page header (the header is grey too) and ends in a line; the filters sit in the band, with no hairline. Juanpa picked it over a tinted card and over putting the timeline in the title.

- Third round (Juanpa, same day): the big timeline with the small filters under it looked loose. Now everything sits **in one row**: the timeline is the lead control (52 px tall, 22 rem wide, its label "Timeline" inside in the accent colour, accent border), a short vertical line, then the filters, and the total at the right. The timeline's facts go right under it; where the big total does not fit (card under 56 rem), it joins those facts ("… · 1,330 results in QA"). Picked over a white container inside the band.

- Fourth round (Juanpa, same day): with the timeline as the lead control the grey is no longer needed. The header is **white** again, with the line from edge to edge under the row (the other pages have white headers, and Fields' grey chips vanished on grey). The total at the right stays. In Fields the cycle picker (only when there are several cycles) left the right edge: it opens the filter row, in the same bordered style as Science program and Result type (`qa-select` `appearance="filter"` + new `showValue`: "Cycle 2026 ⌄" instead of a "1"). The divider before "Core only" in the state chips was removed (it confused). The plain `inline` style is left only for Overview's "Viewing as" (people with several roles).

## Done (design only)
- New `ui/scope-card/qa-scope-card.ts` (`QaScopeCardImports`): eyebrow, picker slot (`qaScopePicker`), meta line, optional aside (`qaScopeAside`) and count, then the projected filters. Its host has no box, only a bottom border; each page gives it the bleed of its own padding so the line runs from edge to edge. Exported from `ui/index.ts`.
- Page headers stay white (the grey of the third round was dropped).
- `ui/select/qa-select.ts`: new `appearance="scope"` (value only, 20 px bold, 18 px on phones, chevron, tag). The `inline` look is unchanged.
- **Results** (`results-view.html/.ts`): eyebrow "Timeline"; meta "Main batch · <step note>" from the selected option; count = `counters().total` "results in this timeline". Search, menus and chips inside. The counters line above the table is unchanged.
- **Overview** (`overview-view.html/.ts`): eyebrow "Timeline"; meta "All 4 live timelines of the active cycle" or "Main/Complementary batch · Live"; count = results of the chosen timeline(s). Program and type menus inside.
- **Fields** (`fields-view.html/.ts`): eyebrow "Configuring result type"; the result type is the big picker; meta "Cycle 2026" (the cycle becomes a small picker at the right when there are several cycles); the state chips inside. `#summaryGrid` still wraps the whole block.
- Only additions in the logic of Yeck's files: display-only computeds (`timelineMeta`, `totalText`, `scopeMeta`) and the imports.

## Tested
- `ng build`: passes. Fields, Results, Overview and UI kit specs: 62 of 62.
- Seen by Claude in the browser on the Overview (design account) at 1440, 768 and 390 px: no horizontal scroll; the full timeline name shows (a first version cut it to "All timeli…", fixed); picking "July 2026 sub-timeline" updates the meta and the count (216).
- Not seen with data: Results and Fields (they need the API; Juanpa checks them in his Chrome). Dark mode not checked.
