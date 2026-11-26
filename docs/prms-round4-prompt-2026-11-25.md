Round 4: type sizes, buttons, cards and the program header. Edit ONLY "PRMS Reporting - QA system.dc.html". Do not touch "PRMS Reporting.dc.html".

Same rule as before: change only how things look. Keep every behaviour, all JavaScript logic, data, routes and states, and every word of visible text. Do not add or remove text, sections or elements; do not move things to other places in the layout.

1. Type scale, on every page:
   - Page title (the main heading of each page: "Welcome back, Juan Pablo", "Results Center", the program name "Breeding for Tomorrow", "Quality Assurance", …): 26px, line-height 1.2, font-weight 700, letter-spacing -0.02em, colour var(--text).
   - Section titles on the page ("Programme overview", "My CGIAR centers", "My science programs", "Other science programs", …): 20px, font-weight 700, letter-spacing -0.01em.
   - Card titles ("About this program", "Reporting status", "Reporting overview", "Recent activity", …): 16px, font-weight 700.
   - Drawer and modal titles: 16px, font-weight 700. Section titles inside drawers and modals: 14px, font-weight 600. Field labels: 13px, font-weight 500. Help and meta text: 12px, colour var(--text-3).
   - Body text, table cells and menu items: 14px. Keep the big KPI numbers as they are.

2. Cards. Every white card on the page canvas (program and center cards, KPI tiles, "About this program", "Reporting status", "Reporting overview", "Recent activity", tables' outer frame, result page panels): background var(--surface), 1px solid var(--border), radius 12px, `box-shadow: var(--shadow-card)`. A box nested inside a card (for example "Reporting velocity" inside "Reporting status", or the total row) keeps its border, gets no shadow, and uses radius 8px.

3. Buttons, everywhere (top bar, page headers, tables, drawers, modals). Use these four tones and two sizes:
   - **Primary.** Only the main action of the view, for example "Report emerging result", "Export CSV", "Submit to QA" or "Save":
     - background var(--primary), text #FFFFFF, font-weight 600;
     - hover background var(--primary-hover).
   - **Secondary.** "Guide", "Columns", "Save draft", "Cancel", the filter buttons:
     - background var(--surface), 1px solid var(--border), text var(--text-2), font-weight 500;
     - hover: border var(--border-strong) and background var(--surface-2).
     - Icons inside take the text colour: the purple icon in "Columns" becomes var(--text-3).
   - **Tonal.** The main action of a single row or card, for example the "Report" button in indicator rows:
     - background var(--tint-2), text var(--accent), font-weight 600, no border;
     - hover background var(--tint-3).
   - **Ghost or link.** Small text actions like "View results →" and "Show more":
     - no background, text var(--accent), font-weight 500;
     - hover background var(--tint).
   - **Sizes.** Medium is min-height 36px, padding 0 14px, 14px font, radius 8px. Small is min-height 32px, padding 0 12px, 13px font, radius 8px. Icon-only buttons are 32px square, radius 8px.

4. Program header band (the area with the program logo, eyebrow, name, Guide / Report emerging result and the Overview / Reporting / All Results / My results tabs):
   - background var(--bg), the same as the canvas, with no purple tint;
   - a 1px bottom border in var(--border).
   - Tabs: the selected tab has text var(--text), font-weight 600 and a 2px underline in var(--primary). Inactive tabs use var(--text-3) with font-weight 500, and hover changes the text to var(--text). Tab text is 14px.
   - Keep the collapse-on-scroll behaviour.

5. Inputs, selects and the filter dropdowns: min-height 36px, radius 8px, 1px solid var(--border), background var(--surface), 14px text. Focus uses the existing `:focus-visible` ring.

When you are done, list what you changed per point, name any place you were not sure about, and confirm that no logic, data or wording changed.

---

## Result (2026-11-25)

- **What the Claude Design assistant reports:**
  - 14 page titles at 26px and 47 card, drawer and modal titles at 16px;
  - 120 field labels at 13px/500;
  - 62 cards with `--shadow-card`;
  - buttons: 22 primary, 68 secondary, 13 tonal and 53 ghost; danger buttons kept their red and only took the new sizes;
  - program band on `--bg` with a bottom border, and the tabs got a hover colour;
  - 90 inputs and 28 filter dropdowns at 36px.
- **Not applied (its call, to decide later):**
  - 14px body and table text everywhere: many tables use 13px, and changing them risks overflow;
  - 12px help and meta text everywhere;
  - the Settings section titles;
  - checking that each view has only one primary button;
  - a few bordered boxes inside drawers that also got the card shadow.
- **Checked on a fresh render at 1440px:** Home, the SP01 Reporting tab and Results Center. No page errors. It reads like QA: titles at 26px, white cards with a soft shadow, outlined tags, secondary Guide / Filter / Expand all, and a single purple primary action.
- **Next, round 5:** empty states, charts, and the leftovers above.
