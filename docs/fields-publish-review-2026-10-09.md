# Fields: review & publish instead of Discard — 2026-10-09

## Why
- "Discard" sat next to "Publish changes" with almost the same weight and wiped every unpublished change in one click, with no confirmation and no undo.
- After discarding, the header said "All changes published", which was false.
- There was no way to undo a single change.
- Publish and Discard only apply to the selected result type, but neither the header nor the type selector showed that, so pending changes in other types stayed hidden.

## Done
- Header: removed "Discard". It now shows "N unpublished changes in <result type>" and one primary button, "Review & publish (N)", which opens the existing review panel.
- Review panel (`fields-publish-confirm.ts`): each change has an "Undo" link (the field goes back to its published configuration). "Discard all" is a secondary text link that asks first ("Discard all N changes? This can't be undone." Keep them / Discard all).
- After a discard, the header says "Changes discarded"; after a publish, "All changes published". Any edit or a result type switch clears that message.
- Result type selector: an option with pending changes reads "… fields assessed · N unpublished".

## Tested
- `npx ng build`: passes (same initial bundle budget warning as before).
- Browser, 1440 px: header text and no Discard button; Undo on one change (3 → 2, header updates); "Discard all" shows the confirmation; "Keep them" keeps them; confirming shows "Changes discarded" and closes the panel. From Knowledge product, the selector shows "Innovation development · 3 unpublished". No console errors.
- Browser, 390 px: header and review panel.

## Pending
- Undoing the last change closes the panel, and focus is not moved anywhere.
- Not committed or pushed.

## Update: review in a pop-up (same day)
- Feedback: "Review & publish" seemed to do nothing (the panel opened further down, under the yellow notice, and clicking again while it was open changed nothing), and the inline panel felt invasive.
- New shared component `ui/dialog/qa-dialog.ts` (`QaDialog` + `QaDialogFooter`, exported from `ui/index.ts`): a centered modal on `@spartan-ng/brain/dialog`, with the same API style as `qa-drawer` (`[(open)]`, title, subtitle, footer slot).
- `fields-publish-confirm.ts` now renders inside `qa-dialog`: the list with "Undo" on each change, "Discard all" (asks first) on the left of the footer, then Cancel and Publish. The button has `aria-haspopup="dialog"`.
- Tested in the browser at 1440 px: it opens centered with focus inside; Esc closes it; it opens again; Undo updates the title (3 → 2); Publish closes it and the header says "All changes published". At 390 px: "Discard all" asks first, and confirming closes it and shows "Changes discarded". No console errors. `npx ng build` passes.

## Update: page-wide publishing (same day)
- Feedback: the button looked global but acted only on the selected result type, so switching types seemed to "reset" it.
- Publishing is now page-wide. The header reads "N unpublished changes in <type>" (one type) or "N unpublished changes in K result types", and the "Review & publish (N)" count stays the same while switching types.
- The pop-up groups changes by result type (heading + count). Undo works per change and per type. Publish publishes every type with changes, and "Discard all" discards them all (after asking).
- `fields-view.ts`: `changeGroups`, `changeCount`, `changeScope`, `publishedOf`; `patch` takes an optional type. `FieldChangeGroupVm` was added to `fields-config.ts`. TODO(api) notes the API may need one call per type.
- Tested at 1440 px: Innovation development starts with 3 changes; switching to Knowledge product keeps 3; one Knowledge product edit gives "4 unpublished changes in 2 result types" and "Review & publish 4"; the pop-up shows both groups; undoing the Knowledge product change leaves one group; Publish gives "All changes published" and the selector has no "unpublished" marks. `npx ng build` passes.
- Environment note: after an intermediate compile error, the dev server kept serving the previous bundle until the files were touched.

## Update: step notice removed (same day)
- Removed the yellow "Step 5 is open until 19 Jul 2026. Anything you publish now applies to results loaded from now on." notice from `fields-view.html`, plus the now-unused `ACTIVE_STEP_NOTICE` (from `fields.mock.ts`) and its field in `fields-view.ts`. The publish pop-up still says the change applies to results loaded from now on.
- Checked the summary cards: they change with the selected result type (Innovation development 47/26/4/16/1/14; Policy change 41/24/2/15/0/12) and with edits (hiding one Policy change field gives Hidden 25, Assessed 14, Core 11). They are not clickable. `npx ng build` passes.

## Update: summary cards became table filters (same day)
- The six summary cards (47 fields, 26 hidden…) were read-only, duplicated the table and used inflated numbers (mock offsets up to the mockup's 47-field form).
- Now there is one row of chips (same style as the result type chips in Results): All fields · Hidden · View only · Assessed · Third-party, then a separate "Core only" toggle. Each count is the real number of rows the chip shows, so the numbers changed (Innovation development: 32 fields, not 47).
- Filtering hides sections with no matching rows, but section headers still count the whole section. A row edited while a filter is on stays visible until the filter or the type changes. With no matches: "No fields match this filter." plus "Show all fields".
- The result type selector now uses the same real "fields assessed" count (Innovation development: 19 = 18 assessed + 1 third-party).
- Removed: `SUMMARY_OFFSETS`, `ASSESSED_OFFSETS` (`fields-config.ts`), `FIELD_SUMMARY_TARGETS` (`fields.mock.ts`), the cards grid and `summaryCols`. `RESULT_TYPES[].assessedCount` is no longer read.
- Tested at 1440 px: the counts match the visible rows (32 / 9 / 1); a Hidden row changed to Assessed stays visible and the counts update (Hidden 8, Assessed 19); Third-party + Core only shows the empty state, and "Show all fields" restores the 32 rows. At 390 px the chips wrap with no horizontal overflow. `npx ng build` passes.

## Update: result type in the filter row (same day)
- The result type select moved from its own row (with a visible "Result type" label) to the start of the filter row: the select (260 px, bold value), a divider (hidden below xl, where the row wraps), then the state chips and "Core only". The accessible name is still "Result type: <type>" on the select.
- It keeps the default select look, not `appearance="filter"`, because the filter style shows only the label and hides which type is selected.
- Tested in the browser: 1440 px fits in one row; 1024 px puts the chips on a second line with no loose divider; 390 px puts the select full width with the chips wrapping and no horizontal overflow. Switching to Policy change updates the chips (26 / 7 / 2 / 17 / 0 / 12). `npx ng build` passes.
