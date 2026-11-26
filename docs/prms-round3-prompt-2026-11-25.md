Round 3: badges, tags, labels and numbers. Edit ONLY "PRMS Reporting - QA system.dc.html". Do not touch "PRMS Reporting.dc.html".

Same rule as before: change only how things look. Keep every behaviour, all JavaScript logic, data, routes and states. Keep every word of visible text; only the letter case changes where point 3 says so.

1. Collapsed sidebar.
   - Replace the PRMS symbol shown when the sidebar is collapsed with `assets/prms-symbol-dark.png` (28px tall, width auto, centred).
   - The science program and center icons in the collapsed sidebar get no purple border. The active one sits on the same white pill as expanded rows: background var(--nav-active-bg), radius 8px, `box-shadow: 0 1px 3px rgba(16,24,22,.08)`.

2. Status badges, on every page (table cells, cards, drawers, result pages, the Quality Assurance module, notifications). Wherever a status is shown as a tinted pill (coloured background and coloured text, often fully rounded), make it the QA dot badge:
   - background var(--surface-5), text var(--text-2), 12px, font-weight 500;
   - radius 6px, padding 2px 8px, `display:inline-flex; align-items:center; gap:6px`;
   - a 6px round dot before the label in the status colour (the `--st-*-fg` colour that status already uses: editing, submitted, QA, approved, rejected, pending, indigo, teal).
   - Statuses already shown as a dot plus plain text (the legends under the progress bars) stay as they are.

3. Uppercase labels. Every label written in uppercase or with `text-transform:uppercase` / letter-spacing becomes sentence case: 12px, font-weight 500, colour var(--text-3), letter-spacing normal. Examples: "BY STATUS" → "By status", "SUBMISSION PROGRESS" → "Submission progress", "RESULTS REPORTED" → "Results reported", "PHASE" → "Phase", table column headers, the eyebrow "SP01 · REPORTING CYCLE 2026 · P25" → "SP01 · Reporting cycle 2026 · P25". Acronyms and codes stay uppercase: SP01–SP13, CGIAR, AoW, HLO, W1/W2, W3, QA, PPU, TPB, KPI, P25, ABC.

4. Property tags (things that describe an item, not its status: "Core", "Projects", "Centers", "Plan", result type or category chips, AoW codes, "CGIAR center", "Science program"): outlined tag. 1px solid var(--border), no background, radius 6px, padding 1px 6px, 12px, font-weight 500, colour var(--text-3). Remove purple or grey tinted fills from these chips.

5. Numbers and codes in one font. Wherever JetBrains Mono (or any monospace font) is used for numbers, counts, codes (SP01, ABC, result codes like 9400), dates or percentages, use the app font Manrope instead, with `font-variant-numeric: tabular-nums` so columns still line up. Keep their current size and weight. Then remove JetBrains Mono from the Google Fonts link in `<helmet>`, so only Manrope loads.

When you are done, list what you changed per point, name any place you were not sure about, and confirm that no logic, data or wording changed.

---

## Result (2026-11-25)

- **Asset:** uploaded `assets/prms-symbol-dark.png` (85×72, 4,495 bytes, matches the local file) for the collapsed sidebar.
- **What the Claude Design assistant reports:**
  - 18 status pills are now dot badges;
  - 92 uppercase labels are sentence case, and 5 labels typed in capitals had their case changed;
  - 26 chips are now outlined tags;
  - 233 JetBrains Mono uses are now Manrope with tabular numbers, and the font link loads Manrope only.
- **Its judgement calls:**
  - QA suggestion severity and "Highlighted" are shown as dot badges;
  - the notification type and the "Admin" chip are outlined tags;
  - left as they were: "Current", "Not public", "Coming soon", "Needs your decision" / "For your information", removable filter chips, count bubbles and segmented controls.
- **Checked on a fresh render at 1440px:** Home, Results Center, Quality Assurance, the SP01 program overview and the collapsed sidebar.
  - No page errors.
  - Zero elements use a monospace font.
  - Console errors are the same 24 template placeholders as before.
  - The collapsed sidebar shows the dark symbol, and the active program sits on a white pill.
- **Next, round 4:** type scale (h1 26px), button sizes and tones, card shadow, and the tinted program band.
