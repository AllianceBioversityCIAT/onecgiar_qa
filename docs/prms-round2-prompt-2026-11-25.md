Round 2: sidebar, logo and top bar. Edit ONLY "PRMS Reporting - QA system.dc.html". Do not touch "PRMS Reporting.dc.html".

Change only how these parts look. Keep every behaviour exactly as it is: collapse/expand state, pinning and searching science programs, counts, links, which item is active, popovers, routes, data and all JavaScript logic. Keep all visible text except the case change in point 3.

1. Logo (expanded sidebar). Replace the current sidebar logo image with `assets/logo-prms-reporting.png`, shown at height 24px, width auto (about 157px), alt "PRMS reporting". Give the logo its own row: 24px space above it, 20px below, 20px from the left edge. In the collapsed sidebar keep showing only the PRMS symbol, centred, as it does today.

2. Collapse button. Move the sidebar collapse/expand button out of the sidebar header and put it in the top bar as the first item on the left, before the Back and Forward arrows. Same click handler, same state, same tooltip/aria label. Style it like the arrows: 32px square, radius 8px, icon 18px in var(--text-3), hover background var(--surface-4).

3. Group labels in the sidebar ("MY SCIENCE PROGRAMS", "OTHER SCIENCE PROGRAMS", "MY CGIAR CENTERS", "PLATFORM", "ABOUT"): sentence case ("My science programs", "Other science programs", "My CGIAR centers", "Platform", "About"), 12px, font-weight 500, colour var(--nav-eyebrow), no letter-spacing, no text-transform uppercase. Keep the count and chevron next to "Other science programs".

4. Nav rows (Home, Portfolio Overview, Results Center, … License): min-height 40px, padding 0 12px, gap 10px between icon and label, radius 8px, 14px font-weight 500, colour var(--nav-fg-2), icons 18px in the same colour. Hover: background var(--nav-2). No border at rest.

5. Selected item: a white raised pill. In the light `:root` block set `--nav-active-bg: #FFFFFF` and `--nav-fg-active: #15201E`. The active row gets background var(--nav-active-bg), text and icon var(--nav-fg-active) and `box-shadow: 0 1px 3px rgba(16,24,22,.08)`. Remove any coloured left bar, purple border or purple text on the active row.

6. Science program and CGIAR center entries in the sidebar (e.g. "SP01 Breeding for Tomorrow", "Alliance Bioversity-CIAT"): same row treatment as point 4. No card background or border at rest. Keep the program logo and the code. The active one uses the white pill from point 5.

7. Lines: dividers between sidebar groups are 1px var(--nav-divider). The sidebar has a 1px right border in var(--nav-divider).

8. Top bar: background var(--bg), a 1px bottom border in var(--border), height 56px. Keep the search, Support, Release notes, Notifications and the user menu as they are.

When you are done, list what you changed per point and confirm that no logic, data or text (other than point 3) changed.

---

## Result (2026-11-25)

- **Logo:** uploaded `assets/logo-prms-reporting.png`, 472×72 (3× for 24px), 8,059 bytes, same as the local file. An SVG upload was dropped first because Claude Design strips `data:` images inside SVGs: the mark came out empty, so that file was deleted.
- **Sent to the Claude Design assistant.** It reports all 8 points done. The JavaScript only changed colour and shadow values; no logic changed.
- **Checked on a fresh render at 1440px:**
  - logo at 24px with its own row;
  - the collapse button sits first in the top bar;
  - sentence-case group labels;
  - Home as a white pill;
  - grey sidebar with a hairline.
  - Console errors are only `{{ }}` template placeholders before render, which the original also has.
- **The editor preview** in Claude Design took longer than 30 seconds to load; the direct render was fine.
- **Left for round 3:**
  - in the collapsed sidebar, the PRMS symbol is still the old purple gradient, and the program icons still have a purple border when active;
  - inside pages, uppercase labels remain ("BY STATUS", "SUBMISSION PROGRESS") and codes and numbers are still in a mono font.
