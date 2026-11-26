# Final visual review — PRMS Reporting and QA (2026-11-26)

Juanpa asked for one last pass on both platforms:
- consistent standards;
- clear card and container hierarchy;
- spacing, layout, sizes;
- nothing that looks AI-made.

He also noticed that the PRMS sidebar, especially About, does not match QA.

## Sidebar: PRMS against QA (measured at 1440)

| | QA | PRMS before |
|-|-|-|
| Row | 40 px, 2 px apart, radius 8, 12 px padding, 18 px icon, 10 px gap, 14/500 | same for Platform and About; program rows 6 px apart |
| Group label | 12/500, text at 16 px from the edge (padding 8 px 4 px) | text at 12 px; "Other science programs" at 16 px |
| Between groups | 20 px, 1 px divider inset 16 px, 16 px to the label | a divider only after Platform; other groups have no divider and uneven gaps |
| Logos | — | program and center logos about 20 px, not on the 18 px icon grid |

## PRMS findings

1. **Tabbed pages (program, center) repeat the tab as a title with a subtitle:**
   - "Programme overview", "Report results linked to the programme's 2026 ToC", "Results", "My results", "Center overview";
   - they add a fourth heading level and push the content down.
2. **Wording:** both "programme" and "program" appear. The app is in US English.
3. **Eyebrow:**
   - there is a double space ("SP01  · Reporting cycle");
   - "CGIAR CENTER" is in capitals.
4. **Card hierarchy on the program overview:**
   - up to four levels: card > section > bordered box (Reporting velocity) > grey band (total row);
   - the KPI tiles carry stray tags (Core, Projects, Centers, Plan);
   - the "All sections / W1/W2 / W3/Bilateral / Areas of work" switch floats between the tiles and the card it filters.
5. **Three different status charts:**
   - donuts on the program overview;
   - a pastel stacked bar on the center overview;
   - a solid stacked bar on Home.
   - The W3/Bilateral bars are all purple while their legend dots use the status colours.
6. **Charts that read as "AI dashboard":**
   - a radar ("Category balance");
   - a Bars / Columns / Heatmap switch on a small card.
7. **The Reporting tab is eight separate floating cards** (one per AoW): a wall of identical cards.
8. **Notifications:**
   - multicolour pastel icon squares;
   - "Mark all as read" and settings sit on a row of their own, so there are three rows of controls before the list.
9. **Card subtitles** under card titles. Juanpa wants titles only, as on Home.

## QA findings

- **Overview:** the "results in QA" card nests grey-filled Round panels inside a white card, and has a green band at the bottom. That makes three levels.
- **Rows with and without chevrons** in the same list: Pending, In review and Assessed by 1 have one; the rest do not.
- **Results, Review, Cycle, Fields and Assessors** use the real API. They cannot be checked with the design account, so they need Juanpa's Chrome.

## Rules applied (both platforms)

- **Levels:** page canvas → card → content. No card inside a card.
  - Inside a card, content is grouped with a 1 px divider and a 12/500 label.
  - A bordered box (radius 8, no fill, no shadow) only for a distinct embedded object.
  - Grey fills inside cards only for table headers and total rows.
- **Card header:**
  - title 16/700, no subtitle;
  - at most one control on the right (ghost link or segmented control);
  - 20 px padding.
- **Spacing:**
  - 16 px between cards in a grid;
  - 24 px between stacked blocks;
  - 32 px before a section title (20/700);
  - cards in one row have equal height.
- **One status chart:** the horizontal stacked bar with a dot legend and counts, in the status colours.
  - Single-measure bars use the main chart colour on a light track.
- **Navigation labels:** "My" for the user's own things; sentence case everywhere.

(Results of each step are appended below.)

## Step 1: PRMS sidebar, headers and wording (done)

- **Sidebar:**
  - group labels start 16 px from the edge;
  - every group has a divider with 20 px above it;
  - rows are 40 px, 2 px apart, in every group;
  - logos are 18 × 18 with radius 4;
  - "Other science programs" is a 32 px clickable label row, and its list rows now match the other groups.
- **Eyebrow:** "SP01 · Reporting cycle 2026 · P25" and "CGIAR center · …", at 12/500.
- **Repeated title blocks removed** from every program tab and every center tab. Each tab starts 24 px below the tab bar.
- **US spelling:** the assistant changed 105 "programme" to "program", including the demo data.
- **Notifications:** the subtitle was removed.

## QA: overview inner boxes (done, not committed)

- `ov-cycle-hero.ts`: the Round 1 and Round 2 panels are outlined boxes with no grey fill.
- `ov-pace.ts`: the Assessment pace figure boxes are outlined boxes with no grey fill.
- These files are Juanpa's own; the change is classes only.
- `ng build` is green. Checked on screen at 1440.

## Step 2: PRMS card hierarchy and charts (done)

**Program Overview**
- First row: the sections switch is on the left and Phase on the right.
- KPI tiles: no tags.
- Reporting status:
  - W1/W2, W3/Bilateral and Reporting velocity are three sections of one card, separated by dividers;
  - the status bars use Home's stacked bar;
  - each section ends with a plain total row and a "View results" link;
  - both funding sections show the "Approved %" chip.
- "Results by indicator category": the Bars / Columns / Heatmap switch is gone; it is now a bar list.
- The radar was replaced with a bar list. It repeated the same numbers, so it is removed in step 3.
- Other cards lost their subtitles.

**Center Overview**
- "Results by status" uses Home's solid stacked bar.
- Cards in a row are equal height.

**Reporting tab**
- One card, with the AoW groups as 56 px rows separated by dividers.
- The output and outcome separators have no grey fill.

**Trade-off:** the bar list uses one colour, so "Results by indicator category" no longer splits each bar by status.

## Step 3: PRMS loose ends and sweep (done)

- **"Category balance" removed:** it repeated "Results by indicator category", which now takes the full row.
- **Notifications:**
  - neutral 32 px circles for icons and initials; the type is shown by the outlined tag;
  - "Mark all as read" and settings moved to the tabs row, leaving two control rows.
- **Sweep, as reported by the assistant:**
  - dialog footers right-aligned, with the primary button last;
  - 58 cases of 10–11 px text moved up to 12 px, and 16 cases of 15 px text moved onto the scale;
  - every ⓘ icon is 16 px and `--text-3`;
  - "All results" is now in sentence case.
- **Display numbers:**
  - 28/700 for headline figures (Home totals, KPI tiles, center status counts);
  - 24/700 for numbers inside cards.
- **Kept as they are:**
  - "Results Center" and "Innovation Packages" in title case, as product names;
  - the inner spacing of components (some 6, 10 and 14 px values remain).

## Checked on a fresh render at 1440

- sidebar;
- program Overview and Reporting;
- center Overview;
- Notifications.

No page errors; the console shows only the template placeholders. The assistant checked drawers and dialogs from the code; I did not open each one.

## Pending

- QA:
  - commit and push the overview inner-box change (`ov-cycle-hero.ts`, `ov-pace.ts`);
  - Results, Review, Cycle, Fields and Assessors still need a look in Juanpa's Chrome with real data.
- PRMS: decide whether the copy replaces the original file. The project must also be moved out of Claude Design before 2026-12-14.

## Sidebar follow-up (same day)

- **PRMS "Other science programs":**
  - it is the last row of "My science programs", under SP07, with no separate group and no extra dividers ("se ve encarcelado");
  - the label is shortened to "Other programs" so it does not cut off;
  - the icon is a layers icon, so it does not repeat Results Center's.
- **Selected item, both platforms.** The flat grey with near-black text looked heavy. I compared four options side by side and chose a soft brand tint with the text and icon in the brand colour, no shadow and no marker:
  - QA: `--nav-active-bg` #DCEBE7, text `--nav-text` #0F766E; dark mode #173835 with #5CC2B8;
  - PRMS: #E3DFF2 with `--accent` #45348C; dark mode #332D4E with #A79BD4;
  - hover stays neutral grey.
- **Checked:** QA desktop, expanded and collapsed; `ng build` green. PRMS on a fresh render, with the list closed and open.

## PRMS result page aligned with QA (same day)

- The whole result page (Sections panel, main area, footer bar) is on the grey canvas, as in QA's review page. The section content stays a white card.
- **Selected section:** a white row with a 1 px ring, a soft shadow and 600 text, exactly as in QA. Other rows have no fill.
- Six grey instruction boxes inside the section cards are now white boxes with a border, like QA's instruction notes.
- **Sidebar "Other programs":** an open program from that list shows the selected tint, and the list stays open.
- **Two selection styles, on purpose:**
  - **Navigation between pages** (sidebar): brand tint.
  - **Choosing inside a page** (sections list, segmented controls such as Mine / All, Received / Sent): white raised row, the same language as the segmented controls.
- **Checked** on a fresh render: no page errors.

## PRMS result page copies QA's layout exactly (same day)

Juanpa's rule: QA is the base, and PRMS copies its patterns.

- **Left sections panel:**
  - white, 240 px, with a right border;
  - the "Sections" label, then rows of 44 px; the selected row is outlined, and pending rows show an orange dot and a count;
  - "N of 5 sections complete", then the AI review text button;
  - the code, type and status moved out of the panel.
- **Main area (grey canvas):**
  - h1 at 20/700;
  - under it, one meta line: code (accent) · SP01 · type · status badge · ⓘ, then "Reporting 2026 · P25" at 12 px;
  - PDF and ⋯ are small secondary buttons.
- **Footer:**
  - white, 72 px, with a top border;
  - Back, Next and "Section 1 of 5" on the left;
  - the state, Save draft and "Submit result" on the right. "Submit result" is the only primary button and moved here from the panel.
- **Notices:** the assistant found no designer or prototype notices in the PRMS file.
  - Kept: the "[Module] loads here." stand-ins on unbuilt pages; removing them would leave those pages blank.
  - Not touched in QA: the "Preview · sample data" notices on Overview and Notifications. Yeck added them on purpose (P2-4079) while those screens use sample data.
- **Checked** on a fresh render at 1440: no page errors.

## Small PRMS fixes (same day)

- "Contributors & partners" now uses the ampersand, as in QA.
- Under the result title only the meta line remains; the "Reporting 2026 · P25" line was removed, since the phase is shown in the sidebar.
- The sidebar has no divider between "Other programs" and "My CGIAR centers", so programs and centers read as one block. The dividers after Platform and before About stay.
- Checked on a fresh render: no page errors.

## QA notice Juanpa wants removed (not done: protected)

- The notice "View only. To act as a reviewer on this result, pick a role in "Act as"." comes from `readOnlyBanner()` in `review.mapper.ts`, by Juanda (2026-11-23).
- The same banner also explains other read-only cases: the step has not opened, the result is finished, or it was auto-validated.
- Removing it is a logic change in a developer's file, so it waits for Juanpa's explicit confirmation or for Juanda.

## QA: avatar and AI suggestion card (same day, not committed)

- **Top-bar avatar:** `--tint-2` background with initials in `--nav-text` (green), like PRMS's purple one (`shell/qa-shell.html`).
- **AI suggestion card (`review/ai/ai-chip.ts`, template only):**
  - Rated fields showed a verdict ("Check", "Looks consistent") and indicative fields showed nothing. Indicative ones now show a neutral "For reference" dot badge in the same place.
  - The category suggestion was one line ("Suggested category: X · Reported: Y"). It is now two labelled columns, "Suggested category" and "Reported category", like the use-numbers block.
  - AI specs: 7 files, 78 tests passing; `ng build` green. Not seen on screen: the review page needs real data (Juanpa's Chrome).
- **Not done (protected):**
  - **Top-bar search box in QA:** Yeck removed it on purpose two weeks ago ("no dead search box"), so a search that does nothing would undo his fix.
  - **Collapse button of the review sections panel:** it is Juanda's "focus" feature (P2-3910), and it does collapse the panel.
- **PRMS "AI review":** it looks pale because it is disabled until the result can be reviewed. When available it is the purple AI text button, the same as QA. Left as is.

## QA: AI card proximity and the search box (same day, not committed)

- **AI card (`ai-chip.ts`):**
  - "Suggested category" and "Reported category" now sit side by side, close together, with a thin vertical line between them (proximity), instead of two wide columns;
  - the use-numbers block (Suggested by the AI | Reported) follows the same pattern;
  - AI specs: 78 tests passing. Not seen on screen: it needs real data.
- **Top-bar search (`qa-shell.html`):**
  - a visual-only search box, the same as PRMS (520 px, right after the back and forward arrows), hidden on phones;
  - Juanpa agreed it with Yeck on 2026-11-26;
  - the left and right header groups no longer grow, so the box keeps its width;
  - checked at 1440, 800 and 390.
- **PRMS "AI review":** left as a text button. It is pale only while it is disabled, and Juanpa decided "no purple box" for AI on 2026-11-25, which QA follows.

## AI buttons: one rule for both platforms (same day)

- **The way into the AI** (a panel button that opens or jumps to the AI): new `ai-tonal` tone in `ui/button/qa-button.ts`, with a soft AI tint background, AI text at 600 and a darker tint on hover.
  - QA: "N fields flagged by AI" in the review sections panel, now full width.
  - PRMS: "AI review" in the result panel; a disabled button keeps the tint at reduced opacity, with its tooltip.
- **Actions inside an AI card** ("Use as comment", "Copy to comment"): stay plain AI text buttons.
- **Why:** AI is a key feature, so its way in should be easy to find without competing with the primary action. This replaces the 2026-11-25 "no purple box" call for this one button only.
- **QA AI card spacing:**
  - padding 16 × 20 px (was 14 × 16);
  - 16 px header gap and 12 px body gap;
  - 20 px between compared values;
  - list rows 6 px apart.
- **Checked:** review and button specs, 12 files and 265 tests passing; `ng build` green. Not seen on screen: it needs real data.

## Top bar and review panel consistency (same day)

**Top bar, measured at 1440 in both apps**
- Before:
  - search: QA 112 px from the left padding edge, white; PRMS 109 px, off-white;
  - bell: QA 18 px, PRMS 16 px;
  - right-hand buttons: QA 36 px tall, PRMS 32–40 px;
  - avatar initials: QA 11 px, PRMS 12 px.
- Now QA is the reference, except the avatar initials:
  - PRMS search at 112 px, white, radius 10;
  - 18 px icons and 36 px items on the right;
  - initials at 12 px in both apps (12 px is the minimum text size).

**QA review sections panel (`review-aside.html`)**
- It now reads as three groups separated by thin lines: sections · progress and AI · "About this review".
- The instruction text lost its grey box and has a small label, so it reads as help, not as a stray message.
- The empty gap between the list and "N of M fields resolved" is now the first divider.

**QA AI card**
- "Show more" was removed for now; the reasoning shows in full.
- The leftover `whyOpen` and `longWhy` state was removed.
- Review specs: 13 files, 268 tests passing; `ng build` green. Not seen on screen: it needs real data.

## PRMS result: the panel shows progress, the footer holds actions (same day)

- **Panel:**
  - "2 of 5 sections complete";
  - "N fields left to submit", only while the result cannot be submitted;
  - the AI review button.
- **Footer:**
  - left: Back · Next · "Section N of 5";
  - right: Save draft · Submit result, with nothing between them;
  - the "Section complete" state and the "4 fields left before you can submit" text were removed;
  - the disabled Submit keeps its tooltip listing what is missing;
  - "Saved Xs ago" stays next to Save draft.
- **Section card header, right side:** "N fields left in this section", which jumps to the first missing field, or the green check when the section is complete. Moved here from the footer.
- **Checked** on a fresh render (General information section): no page errors.
