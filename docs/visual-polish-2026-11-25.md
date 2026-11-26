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

## Round 3 — Review page (same day)
- **Field rows:** each field is now a row of the section card, with a line between fields running edge to edge, instead of a bordered card inside a card. Hidden fields keep their grey band, now across the full width.
- **Values:** values sit on a soft fill with no border.
- **On phones:** the section stays a white card (`p-4`), with rows edge to edge inside it.
- **One primary action per view:** the per-field "Approve", "Mark as highlight" and "Mark when done" are secondary buttons; "Finish assessment" is the only filled green button. Before, 5–10 green buttons per section competed with each other.
- **Tested:**
  - `ng build`: green.
  - `ng test` on `review/**`: 12 files, 265 passed.
  - Playwright at 1440 and 390 px, acting as Assessor: no horizontal scroll.

## Round 4 — Review page consistency and app-wide radius (same day)
- **One state language:**
  - Field states are the same neutral badge with a coloured dot as Results and Cycle: Validated, Not validated, Commented, Answered, Highlighted, the TPB decisions and Changes done.
  - The dot is a real `aria-hidden` element: the meaning is in the text, not in colour alone.
  - Field properties (Core, View only, Context) are outlined tags, so a state and a property never look alike.
- **Hierarchy:** view-only fields read as context. They have no fill, a muted label and a muted value, so the fields to assess stand out.
- **No repeated header:**
  - The left panel no longer repeats the code, type, status and step that sit under the title.
  - It keeps "Assessed by" when there is one.
- **"Act as":** a quiet tool row with a line under it, instead of a white card above the title.
- **AI chip:**
  - The badge says "Indicative" (it said "AI suggestion" twice).
  - The meta line says "No evidence quote".
  - The specs were updated to match.
- **Radius scale, app-wide:**
  - 121 values mapped to three sizes: 6 px (`rounded-md`, badges and tags), 8 px (`rounded-lg`, buttons, inputs, inner boxes) and 12 px (`rounded-xl`, cards).
  - The 3–4 px radii are kept only on chart marks.
  - The Fields state chips and the applied-filter chips are no longer pills.
- **Left for a team decision:** the words "Approve" / "Validated" / "Check all" / "resolved" name the same action. That is QA flow wording, for Santi / Yeck.
- **Tested:**
  - `ng build`: green.
  - `ng test` on `review/**`: 265 passed; the other workspace, UI and shell files: 46 files passed.
  - Playwright at 1440 and 390 px: no horizontal scroll.

## Round 5 — AI blocks (same day)
- **What changed:**
  - The AI suggestion chip and the "AI match" note dropped the purple box: they now have a neutral border and fill like the rest of the page.
  - The AI is named by a small sparkle icon on a lilac tile, plus "AI suggestion" in the normal text colour.
  - "Copy to comment" and "Use as comment" are secondary buttons.
  - Quotes have a grey rule.
- **Why:** this follows Notion AI, Copilot and Linear. A machine hint should read as secondary to the human review, and an all-purple panel is the stock "AI" look.
- **Token budget:** `qa-tokens.css` passed its 4 kB budget by 118 bytes after round 1. The fix was single-layer shadows and 8-digit hex for the shadow and overlay colours, so the budget warning is gone; only the old initial-bundle warning remains.
- **Tested:**
  - `ng build`: green.
  - `ng test` on workspace, UI and shell: 47 files, 614 passed.

## Round 6 — Button hierarchy (same day)
- **Three weights, never more:**
  - Filled green `primary` for the page action ("Finish assessment").
  - New soft green `tonal` for an item's main action ("Approve", "Mark as highlight", "Mark when done").
  - White `secondary` for supporting actions.
- **AI actions:** the `ai` tone is now a purple text button, the lightest weight ("Copy to comment", "Use as comment"). It ties to the AI mark without boxing it.
- **Greys:** the UI is neutral on purpose; colour is kept for meaning: status dots, charts, the AI mark and the action weights.

## Round 7 — AI suggestion block hierarchy (same day)
- **Header:** sparkle mark, then "AI suggestion" (13px semibold) and the kind badge. The facts ("No evidence quote") sit at the right in muted text.
- **Body:** indented under the title text (`pl-7`, flat on phones), in reading order:
  - the answer: "Suggested category" as a small label above the value at 16px semibold; "Reported" beside it, muted;
  - the explanation, at 14px;
  - "Copy to comment" with a copy icon, its label lined up with the text above.
- **Tested:** `ng test` on `review/**`: 265 passed. Playwright at 1440 and 390 px.

## Round 8 — AI block that explains itself (same day)
Juanpa could not tell what "Indicative", "No evidence quote" and the sentence under the category were. The block now says what each part is:
- **Header:** "✦ AI suggestion". The verdict badge (Looks consistent / Check / Review) shows only on rated fields; an indicative field has no verdict.
- **Rows:** labelled, in one label column of 9rem, stacked on phones:
  - "Suggested category | Innovation" (and "Reported" when present);
  - "Why | <the AI reasoning>".
- **Footer:**
  - Above a hairline, the note in plain words, "Only a suggestion · not rated and no evidence quote" (`AI_INDICATIVE_META`; the spec was updated).
  - "Copy to comment" on the right.
  - The note shows even when the chip is read-only.
- **Tested:** `ng test` on `review/**`: 265 passed. Playwright at 1440 and 390 px.
- **Follow-up:**
  - "Copy to comment" moved to the left of the footer, its label lined up with the text above; the note sits at the right.
  - The button got a hover hint: it opens the field's comment box with the Why text in it, editable, and nothing is saved until the assessor saves.
  - The label stays "Copy to comment", as named in P2-3918.

## Round 9 — AI suggestion card, designed as a whole (same day)
Juanpa found the block still confusing: what "Indicative" and "No evidence quote" meant, how long reasoning would look, and what "Copy to comment" did. The mockup was approved first, then built once:
- **Header:**
  - The AI mark and "AI suggestion".
  - On rated fields, the verdict badge in the app's neutral dot style (green / amber / red dot), replacing the coloured `qa-badge`.
  - "Only a suggestion" in muted text at the right (`AI_INDICATIVE_META`).
- **Answer:** one sentence, e.g. "Suggested category: **Innovation** · Reported: …". IRL / IUL keep their headline.
- **Reasoning:** a paragraph. Past about 3 lines (over 240 characters or more than 3 lines of text) it is clamped, with a "Show more" / "Show less" button (`aria-expanded`, `aria-controls`).
- **Evidence:**
  - The quote, when verified.
  - "From the evidence · <source>", linked when it is a URL. The source was in the data but not shown before.
- **Action:**
  - "Use as comment", which is "Copy to comment" in P2-3918; same handler and same events.
  - What it does is written next to it: "Opens your comment with this text. You can edit it before saving." It is wired as `aria-describedby`.
  - The specs were updated for the new label.
- **Tested:**
  - `ng test` on `review/**`: 265 passed.
  - Playwright at 1440 and 390 px with three cases: a category with long reasoning (clamped, then expanded), and an amber level verdict with its source.

## Round 10 — One tag system across Cycle, Assessors and Overview (same day)
Rule: **a property is an outlined tag; a status is a neutral badge with a coloured dot; an alert is an amber band.**
- **Properties → outlined tags:**
  - Cycle: "Loads results", "Complementary batch", "Test", "From step N" (load drawer).
  - Assessors: "Lead".
- **Statuses → dot badges:**
  - Cycle: the step's "In progress", "Waiting for results" and "No one assigned".
  - Cycle: the timeline summary (active / waiting / future / done).
  - Overview: "Behind pace" / "On pace".
  - The no-assignee warning keeps an amber icon.
- **One filled button per view:** in Cycle, "New complementary batch" is secondary; "Load results into QA" stays primary.
- **Amber bands kept:** they are alerts, not statuses.
- **Tested:** `ng build` green; `ng test` on `pages/workspace/**`: 40 files, 574 passed.

## Round 11 — Overview "Progress by timeline" (same day)
- **One progress line per timeline, read left to right:** finished steps are full (`--primary`), the open step fills up, and later steps are empty grey. Bars are 8px.
- **Removed the explaining parts:** the floating "Now · N%" label, the outlined open step, the check marks and the legend. The bar shows the progress by itself.
- **The open step's name** is semibold text instead of green bold.
- **The percentage** sits on the second line with the closing date ("88% · Closes 23 Jul…"); the right column is 12.5rem so nothing wraps. The aria-label still says the percentage.

## Round 12 — Side panels (same day)
Checked with the full mock: Load results, Step, People, Edit timeline (menu) and the Assessor panel. People was already consistent.
- **Load results:** the blue info box became a neutral note (soft fill, grey icon, normal text). There are no blue boxes anywhere else.
- **Step panel:** "Who can work in this step" shows its fixed value as plain text instead of a grey, disabled-looking field (design rule: fixed values read as text).
- **Assessor panel:**
  - Two other fixed values ("Included in the lead…", "All result types") are plain text for the same reason.
  - In the "Blocked for conflict of interest" row, the date overlapped "Reporting" because the last column was 32px. The columns are now auto-sized.
  - "Reporting" is an outlined tag, since it is a property.
- **Tested:** `ng build` green; `ng test` on cycle and assessors: 14 files, 185 passed.

## Round 13 — Step and Assessor panels in sections (same day)
Juanpa: the panels read as loose text with no hierarchy. A mockup was approved, then built once. Wrappers, classes and help text only; every field, binding and condition is unchanged.
- **Shared pattern:**
  - Titled sections (14px semibold), separated by a hairline, each with at most one line of help (12px muted) under the title.
  - Labels are 13px medium.
  - Paired fields sit in two columns, stacked on phones.
  - Every control is full width in its column; before, widths mixed 280/320px and full.
- **Step panel:**
  - **Step:** "Name" and "Who works in it".
  - **Dates:** "Rome time (CET), 24-hour clock" as the section line; Opens and Closes side by side. A locked opening reads "Fixed: the step is open. You can still move its closing date."
  - **Loads results:** a shorter explanation, and "Starts QA round N" as an outlined tag.
  - The closed-step text and the first-step warning are unchanged.
  - Spec: the zone text is matched without its final period.
- **Assessor panel:**
  - **Role:** Nickname and Role, then the permission switch (no extra "Permissions" label on it).
  - **What they assess:** Result types and Science programs.
  - **Conflicts of interest:** was "Blocked for conflict of interest", with the line "Programs this person can never assess."
- **Tested:**
  - `ng build`: green.
  - `ng test` on cycle and assessors: 14 files, 185 passed.
  - Playwright: open step, future step, and the assessor panel at 1440 and 390 px.

## Round 14 — Edit timeline and comments panels (same day)
- **Edit timeline:**
  - "Steps" is a 14px section title, with "Rome time (CET / CEST), 24-hour clock" under it, as in the Step panel. Before, the zone text sat at the right of the title.
  - The notes under the table ("Loading is manual…", "Closed steps keep…") are 12px muted help, so they no longer compete with the table.
- **Comments panel:**
  - Labelled parts in reading order: "Current value", "Comments N", and a "New comment" label above the composer, with a hairline before it.
  - The value box uses the soft fill of the rest of the app.
  - "Quick comment" lost its dashed border; it is a solid secondary-style button like every other.
- **Tested:** `ng build` green; `ng test` on review and cycle: 24 files, 416 passed.

## Round 15 — Final pass (same day)
- **Edit timeline:** a fixed date (open step's opening, or a closed step's dates) has an info button with a tooltip saying why: "This step is open, so its opening date and time cannot change. You can still move its closing date." or "This step has closed: its dates stay as the record of the cycle."
- **Notifications:**
  - The type badge ("Step complete", "Slow program") is the neutral dot badge; the round icon keeps its tint.
  - The active "Notifications" button in the top bar is the white raised style of the nav, instead of mint.
  - The spec now checks the dot colour.
- **Checked and already consistent:** the Fields publish dialog, the menus and the People panel.
- **Tested:**
  - `ng build`: green (only the old initial-bundle budget warning).
  - Full `ng test`: 83 files, 873 passed, 1 skipped.

## Summary of the whole polish
**System (applies everywhere):**
- Grey canvas, white cards with a soft shadow, neutral sidebar.
- Green only for actions, links, focus and progress.
- Three button weights: filled primary, one per view; tonal for an item's main action; white secondary. AI actions are purple text buttons.
- A property is an outlined tag, a status is a neutral badge with a coloured dot, and an alert is an amber band.
- Radius scale 6 / 8 / 12. Sentence case, no spaced uppercase. Numbers in the app font.
- Panels use titled sections with one line of help, fields in two columns, and fixed values as text (with a "why" where useful).

**Screens done:** Overview, Results (title + scope), Review (rows, states, AI card, comments panel), Cycle (steps, cards, Step / Edit timeline / Load / People panels), Fields, Assessors (+ panel), Notifications, export drawer, sidebar and top bar.

**Not touched (open):**
- Login: it has its own branch, `jp-design/login-font`, waiting for Yeck.
- The program screens (`pages/sp/**`): done in round 16.
- The Overview greeting for non-admin roles: done in round 16.
- A dark-mode switch (logged in `docs/ideas.md`).
- The old initial-bundle budget warning.
- `results-view.ts` `totalText` and `overview-view.ts` `scopeCount` are unused (left for Yeck).

## Round 16 — Everything that was left (same day)
Juanpa asked for the standard on every screen and role, not only the admin views. Covered now:
- **System-wide:**
  - `qa-badge` is the neutral dot badge (status colour only in the dot; `neutral` is a plain tag). This changes every badge in the program screens, the AI chip and the UI gallery; `ui-kit.spec` was updated.
  - New `qa-state-card` (`ui/state`): one white card with a title, one line and actions. It is used for load errors and empty states in Results, Assessors, Fields, Review and Cycle, which showed four different styles before.
  - Manrope loads in `index.html`, so the program screens and Forbidden use the app font; before, only the shell loaded it.
  - Field labels are 13px medium in every panel (23 labels were semibold).
- **Overview, other roles** (checked as assessor, lead assessor, TPB and PPU with a temporary local multi-role design account, reverted before saving):
  - Every role sees "Overview" as the page title; the generic "Welcome back, <name>" greeting is gone.
  - In PPU, "Mark when done" is tonal (the item's main action), and "Updated in the Reporting Tool" / "Not updated yet" are dot badges.
- **Program screens (`pages/sp`)**, checked with `.playwright-mcp/mock-sp.js`:
  - Statuses are dot badges.
  - The cards have the soft shadow; the nested QA comment card is a soft fill with no shadow.
  - The count is a neutral badge and the 5 uppercase labels are now sentence case.
  - On phones the list keeps code and title; the type, the answered count and the status go under the title, so there is no sideways scroll.
- **Forbidden:**
  - Grey canvas, a white card with a lock mark, app font, and the app's primary button.
  - Before it had the login's dark green, a pill button and a different font.
- **Panels:**
  - "New complementary batch" has a "Batch" section: Name, then Science programs and Result types side by side.
  - Its leftover help text is 12px muted.
- **Top bar:** the user menu was checked; the active bell icon is dark text instead of accent green.
- **Phone pass at 390px:** Overview, Results, Review, Cycle (and Step panel), Fields, Assessors, Notifications, Forbidden and the program screens. No sideways scroll.
- **Tested:**
  - `ng build`: green.
  - Full `ng test`: 83 files, 873 passed, 1 skipped.

## Round 17 — Fields: Core and AI columns (same day)

- **Problem (Juanpa):** in the Core and AI columns you could not tell a switch that is off from one that does not apply (fields set to Hidden or View only). Both looked like a grey switch.
- **Change:** three clear states.
  - On: green switch.
  - Off: grey switch, which you can still turn on.
  - Does not apply: a muted "—" instead of the switch. The existing tooltip says why ("Set the field to Assessed to mark it as core"), and screen readers hear "Core does not apply: only Assessed fields can have it".
- Read-only view (closed cycle) still shows the switches as they were.
- **Tested:**
  - `ng build`: green.
  - Fields tests: 4 files, 22 passed (the AI test now expects the "does not apply" text instead of a disabled switch).
  - Checked on screen at 1440px, including the tooltip.

## Round 18 — Sidebar one tone darker (same day)

- **Why (Juanpa):** the sidebar had the same grey as the page, so it did not read as a sidebar. PRMS will share this system with its own brand colour, so the separation cannot come from a brand tint (the soft-green sidebar was tried before and rejected).
- **Change:** sidebar `--nav-bg` #F4F5F4 → #ECEFED, with a hairline on its right edge (`--nav-divider` #DCE1DE). Hover `--nav-2` → #E2E6E4 so it still shows on the darker grey. The selected item stays a white raised pill.
- PRMS would use the same neutrals; its brand colour goes only in the logo, primary button, links, focus, selected icon, current step and charts.
- **Tested:** sidebar colour read from the page (rgb 236, 239, 237); checked on Results and Cycle at 1440px. Text on the sidebar keeps AA contrast. Dark mode not touched (no switch yet).

## Round 19 — Green QA logo (same day)

- **Why (Juanpa):** QA and PRMS Reporting share the PRMS mark. Recolouring the whole mark per product felt unprofessional, so the master brand stays one neutral colour and only the product name carries the product colour (QA green; Reporting would be purple).
- **Change:** new `client/public/logo-prms-qa.svg` from Juanpa's final file: mark and "PRMS" in near-black #0D0D16 (his final pick, after a dark plum #271A28), "quality assurance" in #0F766E (`--primary`), 728×82, shown at 178×20 px. His matching Reporting logo uses the same near-black with "reporting" in #45348C (kept for the PRMS work, not in this repo). A first try with the whole mark in green was dropped the same day. The sidebar uses it instead of `logo-prms-qa.png` (the PNG stays in `public/`, unused by the shell).
- His export was 1.8 MB because the mark is a 3091×4096 picture used as a mask. The mark was cropped to its visible part and scaled to 290×246 (still about 12× its size on screen). The file is now 75 KB; the words are vector paths.
- **Tested:** the logo loads in the sidebar at 174×20 px and was checked on screen at 1440px.

## Round 20 — Sidebar hierarchy: bigger logo, cycle at the bottom (same day)

- **Why (Juanpa):** the top of the sidebar felt squeezed and flat: a small logo next to the collapse button, then the cycle text, then the menu. His reference: a bank app with the brand on top, the menu, and an information block at the bottom.
- **Changes (`shell/qa-shell.html`, layout only, same handlers):**
  - Logo 24 px tall on desktop (was 20), with the row to itself. On phones it stays 20 px, because the close button shares the row. Collapsed, only the PRMS mark shows.
  - The desktop collapse button moved to the start of the top bar, before Back and Forward (as in Claude and Jira). Same `toggleMenu()`, labels and `aria-expanded`; added `aria-controls`.
  - The active cycle moved to the bottom of the sidebar as a soft grey panel (no border, shadow or hover, so it does not look clickable), with a calendar icon. Lines: name + status, "Main batch · Step 1 of 5", "Closes 05 Dec". Still information only and admins only.
- **Tested:** `ng build` green; shell tests 3 files passed; checked at 1440px (open and collapsed) and 390px (menu open, no sideways scroll).

## Round 21 — Room for the logo, a fuller cycle panel (same day)

- **Why (Juanpa):** the logo sat against the top edge, and the cycle block at the bottom looked too timid.
- **Logo:** 24 px of room above and 20 px below, and 20 px from the left edge (was 16 / 16 / 16).
- **Cycle panel:** new `shell/cycle-panel.ts` (`qa-cycle-panel`), used by the shell. It shows:
  - the name, with the status on the right;
  - "Main batch · Step 1 of 5", with a bar of one segment per step (done = green, current = light green, upcoming = grey);
  - a clock and the full closing time, "Closes 05 Dec, 18:00 CET".
- **No new data:** everything comes from the card line that `shell/active-cycle.ts` already builds, read by `cyclePanelView()`. Lines without a step ("Waiting for results", "No main batch yet") show as text with no bar; "All N steps completed" fills the bar.
- **Tested:**
  - `ng build`: passes, with the same initial-bundle budget warning as before.
  - Shell tests: 4 files passed (new `cycle-panel.spec.ts`).
  - Checked at 1440px and 390px; no sideways scroll.

## Round 22 — Page scope dropdown (same day, undone)

- A white control with border and shadow was tried for the big dropdown next to each page title, because the grey fill could read as disabled. Juanpa preferred the grey container, so it was put back exactly as it was (`ui/select/qa-select.ts` has no change).

## Round 23 — Final review before upload (same day)

- **How:**
  - A read-only code scan against the direction-A rules: tokens, radius 6/8/12, dot badges, sentence case, `qaBtn`, font sizes and weights, state cards, English text, no `ngClass`/`ngStyle`/inline style.
  - Captures of every screen at 1440px and 390px.
- **Fixed:**
  - **Status badges with their own colours → dot badges:**
    - "Invited" in Assessors (amber dot); "Has an account" is now an outlined tag.
    - "Highlighted" in the comments panel (red dot, same as on the field card).
    - "Possible mismatch" / "Looks consistent" in the AI note.
  - **"N fields flagged by AI"** in the review side panel was a hand-made purple box; it is now the app's AI button (`qaBtn tone="ai"`).
  - **Notification batch tag:** a rounded pill at 11px → outlined tag at 12px, like Cycle's tags.
  - **Loading placeholders:** shaped like pills → the radius of what they stand in for (badges 6px, Fields filter chips 8px).
  - **Fonts:** JetBrains Mono no longer downloaded (`--qa-mono` points to Manrope; shell and UI gallery).
  - **Phone, Review header:** the status and its ⓘ stay together, so the icon no longer wraps alone onto a line.
  - **Phone, Cycle:** the "…" menu stays beside the batch title. It took a row of its own because `timeline-actions` was full width on phones; it is now full width only when it also holds a button.
- **Checked and kept:**
  - Page and card titles are bold and panel section titles (14px) are semibold: a deliberate hierarchy, not an inconsistency.
  - Chart bars at 3px radius are chart marks.
  - The 11px inner radius of table headers matches their 12px card.
- **Not done (needs its own work):**
  - The login and password screens still use the older style system: raw sizes, pill buttons, raw shadows, a mono font. Pending on `jp-design/login-font`.
  - About 10 empty states (Cycle "No active cycle", People panel, Notifications, program screens) are hand-built cards that look close to `qa-state-card` but don't use it.
- **Tested:**
  - `ng build`: passes (same initial-bundle budget warning as before).
  - Full `ng test`: 84 files, 876 passed, 1 skipped.
  - Checked on screen at 1440px and 390px.
