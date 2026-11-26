# PRMS Home and Portfolio overview: new composition (2026-11-25)

**Why:** after rounds 1–5 (look only), Juanpa found that Home and Portfolio overview still look "AI-made". The problem is composition, not colour:

- **Home:** a wall of 14 identical cards. Nothing separates the user's own programs from programs they only look at. The right column ends half-way down the page and leaves a hole. Every card carries a four-colour bar and a big number, so nothing leads.
- **Portfolio:** the category chart shows bars that are nearly equal (31–37), so it says nothing. The two middle cards have different heights, which leaves empty space. The most useful part, the program table, comes last and has no visual.

## References and what we take from each

| Reference | Pattern we borrow |
|---|---|
| Asana Home, Linear "My issues" | A personal home opens with *your* work and *what changed*. Reference content sits below in compact form. |
| Stripe Dashboard home | One summary band at the top: one hero number, its breakdown and its trend, in a single card split into zones. |
| Vercel and GitHub dashboards | Your own projects as a short row of equal cards. Everything else is a dense list, not more cards. |
| Atlassian Jira "For you" | Activity is the wide column, because it has long text. Navigation lists are the narrow column. |
| Datadog and Grafana tables, Linear Insights | A table becomes the main chart when each row carries an inline bar. Avoid separate charts that repeat the table. |

**Rules for both pages:**
- one focal point per band;
- the status colours appear in one summary bar, not on every card;
- rows in the same band have equal heights;
- 12-column grid with a 24px gap;
- no new data, no new wording, and no changed behaviour.

## Home: layout spec

Content max-width is 1200px. The page padding stays as it is.

1. **Header.**
   - Left: "Welcome back, Juan Pablo" (26px), with the phase line under it ("Reporting 2026 · P25 · closes in 24 days").
   - Nothing else moves into the header.

2. **Summary band.** One full-width card made from the old right-hand "Reporting overview", padding 24px, split into three zones by 1px `--border-soft` vertical dividers:
   - **Zone 1 (3/12):** the label "Results this phase" (12px `--text-3`), the hero number 181 (36px/800) and the existing line "across 2 programs".
   - **Zone 2 (5/12):** the label "By status", one 8px stacked status bar, and its legend in one wrapping row: dot, label and count for each status.
   - **Zone 3 (4/12):** the label "Submission progress" and the three existing rows (SP01 16/167, SP07 1/14, ABC 5/38). Each row has a code tag, a 4px bar in `--chart-3` on a `--border-soft` track, and the fraction on the right.
   - The old right-hand "Reporting overview" card is removed: its content now lives here.

3. **"Your programs and centers".** The two existing sections "My CGIAR centers" and "My science programs" merge under this single section title: 20px, with a count chip showing 3.
   - **Order:** programs first, then centers.
   - **Layout:** 3 equal cards in one row (4/12 each), equal height, padding 20px. On narrow widths they wrap 2 + 1.
   - **Card header:** the logo (28px, radius 6px), the code tag and the type tag, with the arrow button top-right.
   - **Name** at 16px/700.
   - **Main line:** "167 results this phase", with the number at 22px/700.
   - **Status bar:** one 6px status bar, with a legend that lists only the non-zero statuses, on one line.
   - The whole card stays clickable, as today.

4. **Bottom row:** two columns, equal height, `align-items: stretch`.
   - **Left (8/12): "Recent activity".** This is the existing card and its items, moved here.
     - Rows are 14px, with the title and the time on one line, the description on one line (ellipsis) and "by …" at 12px.
     - "View all in notifications" sits at the bottom as a ghost link.
   - **Right (4/12): "Other science programs".** The 11 existing program cards become a compact list in one card:
     - each row is 44px: logo 20px, code tag, name (truncated) and "22 results" on the right;
     - rows have a hairline between them and a hover of `--surface-3`;
     - each row opens the program, like the old card's arrow.
     - Keep the count next to the title.

5. **Empty space.** Nothing should end half-way. If the activity list is longer than the program list, the program list card stretches to the same height.

## Portfolio overview: layout spec

1. **Header:** as it is today (eyebrow, title, subtitle and any phase selector).

2. **Summary band.** The "Results in this phase" card, with padding 24px.
   - The five numbers stay in one row with their dividers.
   - Below them, add one full-width 8px stacked bar of the existing counts as a share of the total: Editing, Submitted, Quality assessed and Approved, in their status colours. Any remainder is the empty track.
   - The legend is the dots already shown above the numbers, so no new text is needed.

3. **"Progress by science program" moves up** to sit right under the summary. It is the main element of the page.
   - Add an inline 8px stacked status bar per row (Editing, Submitted, Quality assessed and Approved for that program), in a 180px column between the program name and the numbers.
   - The "All programs" total row gets the same bar.
   - Sorting, column order, the numbers and the total row stay as they are.

4. **Bottom row:** "Results by indicator category" and "Bilateral results", side by side, equal width (6/12) and equal height, using the same list pattern.
   - **Rows:** each row is 36px with a hairline. The label (14px) is on the left. The bar fills the middle: 6px, radius full, `--chart-2` fill on a `--border-soft` track, scaled to the largest value in that card. The count (14px/600, tabular numbers) is on the right.
   - **Header:** the card title, with the total ("100") as a count chip next to the title instead of a separate big number.
   - **Rows shown:** the same number of rows in both cards (the larger of the two). "View all" is a ghost link at the bottom of the bilateral card.

## Checks after building

1440px and 1280px. The Home bottom columns end at the same height, nothing floats, there are no empty half-columns, and no text overflows. The console shows only the known `{{ }}` placeholders.

---

## Result (2026-11-25)

**Home.** Built by the Claude Design assistant in two passes.

- **Pass 1, the spec above.**
- **Pass 2, refinement:**
  - The summary band now has two zones. "Submission progress" was dropped from it because the cards below already show it.
  - The cards show "16 of 167 submitted" with one `--primary` bar, and the statuses as plain text ("150 editing · 14 submitted …"), so the status colours appear only once on the page.
  - The "Other science programs" rows share the card height, so it ends level with "Recent activity".
- **New display values in JS** (derived only from existing data):
  - pass 1: `ovAcross`, `yourCount` and `yours`;
  - pass 2: the submitted count (quality assessed + submitted, which matches the old 16/167), the submitted percentage and the status text.
- **New wording:** only "Your programs and centers" and "of … submitted".

**Portfolio overview.**

- **Summary:** a stacked status bar sits under the 5 numbers.
- **Program table:** moved up to sit under the summary, with an inline status bar per row and on the total row. Sorting, columns and numbers are unchanged.
- **Bottom cards:** the category and bilateral cards share one list pattern and an equal number of rows. Each title has a count chip: the category chip shows 240, the sum of results with a category, and the bilateral chip shows 100.
- **New display values in JS:** `poSumSegs`, `segs` per row, `isFirst` and `poCatsTotal`.

**Checked on a fresh render at 1440px and 1280px.**

- No page errors.
- On Home, the bottom columns end level, nothing floats, and only the summary carries status colours.
- On Portfolio, the table headers wrap cleanly at 1280px ("Quality assessed" takes two lines), and the bottom cards end level.

**Minor, left as is:**

- On Portfolio, the category card has a little space above the level of the bilateral card's "View all".
- On Home, the program names reserve two lines, so the progress blocks align across the cards.

## Home, refinement 3 (2026-11-25, after Juanpa's review)

- **What Juanpa found:**
  - The top summary band ("Results this phase" 181 + "By status") was hard to read and had a lot of empty space on the right. It was also not what a user needs first on Home.
  - The cards had too much space between the name and "167 results" (the name reserved two lines).
- **Changes:**
  - **Summary band removed.** Its fact now sits in the subtitle: "Reporting 2026 · P25 · closes in 24 days · 181 results across 2 programs". Your programs are the first section.
  - **Card hierarchy in three levels:**
    1. Logo 32px with the name (16px/700) and the meta "SP01 · Science program" as text.
    2. "167 results this phase" (24px number).
    3. A progress block pinned to the bottom: bar, "16 of 167 submitted", and the status line.
  - **QA spacing:**
    - page padding 32px, 32px between sections and 12px from title to content;
    - 16px between cards, 20px padding and 4px from title to subtitle.
- **Checked** on a fresh render at 1440px, with no page errors.

## Results Center: proposal (waiting for Juanpa)

- **Today:**
  - 8 equal-weight controls wrap onto two rows.
  - "Columns", a table setting, sits with the page actions.
  - "Guide" competes with "Export CSV".
- **Proposal:**
  - One row: search plus Program, Phase and Status, then "More filters" with an active count. It holds Indicator category, Portfolio, Center and Funding source.
  - "Columns" moves next to the result count, above the table.
  - "Guide" becomes a quiet link, and "Export CSV" stays the only primary.
- **New interaction:** "More filters" is a popover. That is a new state in the prototype, so it needs Juanpa's OK.

## Removals asked by Juanpa (2026-11-25)

- **Results Center:** the "Funding source" filter and the "Guide" button are removed, and the rest of the toolbar is unchanged. The filters now fit in one row at 1440px.
- **Sidebar:** "Bilateral Results" and "Administration" are removed (expanded and collapsed). Their page code stays in the file.
- **Checked on a fresh render:** none of the four labels appear on Results Center or in the sidebar.
- **Side effects the Claude Design assistant flagged:**
  - In Notifications, the next step for a bilateral notification still opens the Bilateral Results page.
  - The Portfolio "Bilateral" links (card rows, "View all" and the table column) open Results Center filtered by funding source. That filter now has no visible control, so the user can only clear it with "Clear all filters". This needs a decision when Home and Portfolio merge.

## Proposals waiting for Juanpa

1. **Merge Home and Portfolio overview into Home**, from top to bottom:
   1. Welcome.
   2. Your programs and centers (3 cards).
   3. Recent activity (8/12) next to the portfolio summary, "Results in this phase" with its status bar (4/12).
   4. "Progress by science program", the table with bars. It replaces the "Other science programs" list.
   5. Category and bilateral cards.
   "Portfolio Overview" then leaves the sidebar.
2. **Phase information moves to the bottom of the sidebar**, as in QA: "Reporting 2026 · P25", open, closes in 24 days. To keep the sidebar light, the About links (Developers, Glossary, AI use in PRMS, Terms and conditions, License) move into the existing "Support" menu in the top bar.
3. **Sidebar order:** Platform first, then My science programs, My CGIAR centers and Other science programs. Main navigation stays in a fixed place, as in QA, Linear and Slack.

## Applied after Juanpa's OK (2026-11-25)

- **"Guide" removed everywhere:** the program header (expanded and collapsed band) and Innovation Packages. Results Center had already lost it.
- **Sidebar order:**
  - Platform (Home, Results Center, Innovation Packages, Quality Assurance);
  - My science programs, My CGIAR centers and Other science programs;
  - the phase panel at the bottom ("Reporting 2026 · P25", clock + "Closes in 24 days"). It shows only when the sidebar is expanded and is not clickable, like QA's cycle panel.
- **"About" links moved** into the top bar's Support menu, under a divider and an "About" label.
- **Home and Portfolio merged:**
  - Home, top to bottom: header ("181 results across 2 programs"), Your programs and centers (3 cards), Recent activity (full width, one line per item), then Portfolio (summary, program table with bars, category and bilateral cards).
  - Removed: the "Other science programs" list card on Home, and "Portfolio Overview" from the sidebar.
  - The bilateral rows are plain now (no hidden filter), and the dead "View all" is removed.
- **Checked on a fresh render at 1440px and 1280px:** no page errors, the sections are in order, no text overflows, the bottom cards end level, there is no "Guide" button on the program pages, Innovation Packages or Results Center, and the Support menu shows the About links.
- **Still open:**
  - a bilateral notification's next step still opens the hidden Bilateral Results page;
  - table text at 13px vs 14px;
  - whether the copy replaces the original;
  - moving the project to Claude before 2026-12-14.

## Requested next, paused (2026-11-25)

- **The changes Juanpa asked for:**
  1. Remove "Columns" from Results Center.
  2. Put the About group back in the sidebar, below Other science programs, with Release notes as its first item. Remove Release notes from the top bar and About from Support.
  3. In the Reporting tab, remove the nested HLO sub-accordions inside each area of work: one table header per area of work, with "High level outputs" / "Outcomes" as plain separators.
- **Status:** the request is sent in the Claude Design chat, but the assistant stopped at the account's 5-hour usage limit ("resets Thu 2:00 AM"). The file etag (`1795666335544701`) predates the request, so nothing from it was written. After the reset, press "Resume" in the chat, then check the result.

## Resumed and applied (2026-11-26, 02:13)

- **How:** the usage limit had reset. The request was resent in a new Claude Design chat; the old one carried 375k tokens of context.
- **Applied:**
  - "Columns" is removed from Results Center. The Claude Design assistant also cleaned up leftover markup that had broken the header layout.
  - The About group is back in the sidebar, below Other science programs. Release notes comes first and gets a small unread dot, which is new and uses the existing unread flag. Release notes is out of the top bar, and Support keeps only its own three items.
  - In the Reporting tab, the nested HLO sub-accordions are gone. Each area of work has one header row, with "High level outputs" and "Outcomes" as plain separators. The assistant applied the same change to "Intermediate outcomes" and "2030 outcomes", which used the same subgroups.
- **Checked on a fresh render at 1440px:**
  - The sidebar order is right and the phase panel sits at the bottom.
  - Results Center has no Columns button.
  - The top bar has no Release notes.
  - AOW01 opens straight to its indicators.
  - No page errors.
  - The Support menu contents were not captured in a screenshot; the assistant reports that it has 3 items.

## Sidebar cleanup (2026-11-26)

Juanpa asked to remove the extras from the About group.
- The unread dot next to "Release notes" is gone, in the expanded and the collapsed sidebar.
- The ↗ arrows next to Glossary, AI use in PRMS, Terms and conditions, and License are gone.
- Links, icons, order and where each link opens did not change.

Checked on a fresh render at 1440, expanded and collapsed. No page errors; the console shows the same template placeholders as before.

## Home fixes (2026-11-26)

- **Recent activity:** "View all in notifications" moved from the card footer to the right end of the section title row, the same way QA puts actions on the header line. The empty footer row is gone.
- **Portfolio:** the subtitle was removed. No other section title on Home has one.
- **"Results by indicator category" and "Bilateral results":**
  - rows are 44 px, like the "Progress by science program" table (they were 36 px);
  - the cards have 8 px of padding at the bottom, so the last row no longer sits on the border.
- **Not changed:** the hidden Portfolio overview page still has the old copies of those two cards.
- **Checked** on a fresh render at 1440: no page errors; the console shows the same template placeholders as before.

## List pages and My results (2026-11-26)

Juanpa asked for consistency: the spacing between the filters and the table was different on each list page.

- **One layout for Results Center, Innovation Packages, Quality Assurance and the program's All Results tab.** Results Center is the reference.
  - Header to filter bar: 24 px.
  - Search box: 320 × 36 px.
  - Dropdowns: 36 px, auto width, 8 px apart.
  - A second row (chips, status tabs or status summary): 12 px below the filters.
  - Count line: 20 px below the filters. Table: 12 px below the count line.
  - Table rows: at least 60 px, with 20 px padding at both ends. Header row: 40 px.
- **All Results tab:** the "Columns" button was removed, as it had been in Results Center.
- **My results board:** each column header is 14/600 with an icon in its status colour:
  - "Needs my action": alert circle, orange.
  - "Waiting on others": clock, blue.
  - "Done": check circle, green.
  - A 3 px coloured top border was tried and removed: it read as the typical "AI card".
- **Scroll on My results:** in a fresh render the page scrolls to the end of the columns. Not reproduced.
- **Still open:**
  - The Quality Assurance table is wider than the page at 1440, and its last column is cut off. This was already the case before this pass.
  - All Results filters with a single "Filter" button; the other pages show one dropdown per filter.
- **Checked** on a fresh render at 1440: no page errors; the console shows the same template placeholders as before.
- **My results tab icon (2026-11-26):** the board icon became an outline user icon (in the style of Lucide "user-round"). This applies to the tab row and the collapsed program band. Checked on screen.

## Sidebar selection, Quality Assurance removed, "My" labels (2026-11-26)

- **Selected sidebar item:** a flat #D4DBD8 row with 600 text and no shadow, the same as QA.
- **Quality Assurance is no longer in PRMS Reporting:**
  - it was removed from the sidebar, expanded and collapsed;
  - the two "QA comment" rows in Recent activity (4231, 4238) now open their result;
  - the page code is still in the file but nothing links to it, like Bilateral Results.
- **Tone rule:**
  - section and navigation labels for the user's own things use "My";
  - sentences addressed to the user keep "your".
- **Text changes from that rule:**
  - "Your programs and centers" became "My programs and centers";
  - the account menu now reads "My science programs" / "My centers" (sentence case);
  - the "Your program" tag became "My program".
- **Checked** on a fresh render: no page errors, and no Quality Assurance link in the sidebar.
