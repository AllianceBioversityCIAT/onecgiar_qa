# Cycle: prominent "New sub-timeline" button and date pickers — 2026-10-09

## Done
- Cycle: "New sub-timeline" uses the primary (green) button style, like "Load results into QA".
- New shared component `ui/date-picker/qa-date-picker.ts` (`QaDatePicker`, exported from `ui/index.ts`). It is a calendar button placed inside a text date field and is built on `@spartan-ng/brain` calendar + popover, which were already installed (nothing new added to `package.json`).
  - `mode="single"` reads and writes "06 Jul 2026"; `mode="range"` reads and writes "20 Jul – 24 Jul 2026".
  - Typing in the field still works; the calendar opens on the month of the current value (or today when empty).
- Calendar added to every date field in Cycle:
  - Step drawer: Opens, Closes, and the Extended access dates (range).
  - Timeline drawer (new / edit sub-timeline, edit official): each step's Opens and Closes. Desktop date columns went from 124 px to 148 px; on narrow screens Opens and Closes each take a full row.
- Step drawer: on narrow screens the Extended access dates wrap to their own line (they overflowed sideways).

## Tested
- `npx ng build`: passes (same initial bundle budget warning as before, now 553 kB vs 500 kB).
- Browser, 1440 px: the green button; picking 14 Sep in the step 1 Opens calendar fills "14 Sep 2026" and closes the popover; reopening shows 14 selected; Escape closes it; the range picker fills "20 Oct – 24 Oct 2026". No console errors.
- Browser, 390 px: timeline drawer and step drawer, with no horizontal overflow.

## Pending
- The calendar's "today" is the real date, not the mockup's "today" (19 Jul 2026).
- Not checked with a screen reader.
- Not committed or pushed.

## Also: Assessors coverage banner removed
- Removed the red "N result types have no active assessor. N results will not be reviewed." banner and its "Show them" button from `assessors-view.html`. `gaps`, `gapResults` and `showGaps` stay in `assessors-view.ts` (now unused by that template).
- The same warning still appears in Overview > Needs attention (`overview.mock.ts`, `ATTENTION`); it was not touched.
- Tested: `npx ng build` passes; /assessors at 1440 px shows no banner and no console errors.

## Also: Assessors "Download team list" removed
- Removed the "Download team list" button from `assessors-view.html`, plus its now-unused code in `assessors-view.ts`: the `download()` CSV export, the `DOCUMENT` injection and the `DOCUMENT` / `inject` imports.
- Tested: `npx ng build` passes; /assessors at 1440 px and 390 px shows only "Invite assessor" in the header, with no console errors.

## Also: "New sub-timeline" help tooltip
- Added an ⓘ button to the right of "New sub-timeline" (`cycle-view.html`) with: "A sub-timeline is a second calendar for results that did not make it into the official timeline. Pick the programs and result types that are running late, give them their own dates, and load their results when the first step opens."
- Not built on `qaTooltip`: that tooltip can only center itself on the icon, and at the page edge it flipped to the left and covered the button. This one is a local tooltip that opens below the icon, aligned to its right edge (`subHelp` signal in `cycle-view.ts`). It opens on hover or keyboard focus, closes on Esc, blur or mouse leave, can be hovered (no gap) and is linked with `aria-describedby`.
- Tested at 1440 px and 390 px: hidden at first; shown on hover and on focus; hidden on mouse leave and on Esc; stays visible while the pointer moves onto the text; inside the viewport and not covering the button. `npx ng build` passes.
- Possible follow-up: if more tooltips need right alignment, add an alignment option to the shared tooltip instead of repeating this.

## Also: "load results" icon
- The circular "refresh" arrow read as "update/sync", not "bring results into QA". It was replaced with an arrow going into an open tray (Lucide "import" shape: `M12 3v12M8 11l4 4 4-4M8 5H4…`) in three places: the "Load results into QA" button (`cycle-view.html`), "Load results into this step" (`step-drawer.ts`) and the "Loads results" tags on steps (`timeline-steps.ts`).
- "Synced until 17 Apr" (`timeline-steps.ts`, sync template) keeps the circular arrow, because there it does mean sync.
- Tested in the browser: the button and the tags render the new icon and it reads well at 11 px (checked at 3× zoom). `npx ng build` passes.
