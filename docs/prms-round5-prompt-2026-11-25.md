Round 5 (last): leftover colours, charts, empty states and loose ends. Edit ONLY "PRMS Reporting - QA system.dc.html". Do not touch "PRMS Reporting.dc.html".

Same rule as before: change only how things look. Keep every behaviour, all JavaScript logic, data, routes and states, and every word of visible text. Do not add or remove text or elements.

1. Leftover hard-coded colours. Search the whole file, both the markup and the JavaScript strings, for these old hex values and replace each one with its token:

   Old purple:
   - #6B46E5 → var(--primary)
   - #5733C4 → var(--primary-hover)
   - #4A2BB8 → var(--accent-strong)
   - #8B79D6, #9270F0 and #8B7CC4 → var(--primary-soft)
   - #C4A0F7 and #C4B5FD → var(--chart-1)
   - #271862 → var(--chart-4)
   - #F5F3FF → var(--tint)
   - #EDE9FE and #E4DEF9 → var(--tint-2)
   - #DDD6FE → var(--tint-3)
   - #A79BD4 → var(--tint-text)
   - rgba(107,70,229,…) → rgba(90,69,184,…), keeping the same alpha.

   Old purple-tinted greys:
   - #191524 → var(--text)
   - #2B2838 → var(--text-2)
   - #5D5872 → var(--text-3)
   - #6B6580 → var(--text-4)
   - #9691A8 → var(--text-muted)
   - #E3E3E8 → var(--border)
   - #EEEEF1 → var(--border-soft) when it is a line, var(--surface-4) when it is a fill
   - #D5D5DC → var(--border-strong)
   - #F7F7F9 → var(--surface-3)
   - #F3F2F7 → var(--surface-5)
   - rgba(25,21,36,…) → rgba(16,24,22,…), keeping the same alpha.

   Where an SVG presentation attribute (`fill="#…"` or `stroke="#…"`) cannot take var(), use `style="fill:var(--x)"` / `style="stroke:var(--x)"`, or currentColor with the colour set on the parent. Leave the program colours (`--prog-*` and the program logos), the status colours (`--st-*`) and the dark theme block alone.

2. Charts: donuts, progress bars, reporting velocity and pace lines, radar, bars and maps.
   - Use the purple ramp from light to dark: var(--chart-1), var(--chart-2), var(--chart-3), var(--chart-4).
   - Use var(--chart-3) for "done" or the main series. Use var(--border-soft) for empty tracks. Keep status colours where a chart shows statuses.
   - Gridlines are 1px var(--border-soft). Axis labels are 12px var(--text-3) in Manrope.

3. Empty states, the "no results" and "nothing here yet" blocks. Show each one as a white card:
   - background var(--surface), 1px var(--border), radius 12px, box-shadow var(--shadow-card), padding 24px 20px, content aligned left;
   - its existing heading at 16px/700 var(--text), and its existing message at 14px var(--text-3), line-height 1.55;
   - its existing buttons below, using the round 4 button tones.
   - Do not write new headings or messages. If an empty state has only one line of text, show that line as the 14px message.

4. Loose ends from round 4:
   - One primary button per view. Where a single view shows two or more primary (solid purple) buttons, keep the main action primary and make the others secondary. Tell me which ones you changed.
   - Bordered boxes inside drawers and modals have no shadow. Card shadows are only for cards on the page canvas.
   - Settings modal: "Appearance" and "Workspace setup" are section titles, at 14px/600 var(--text).
   - Leave table cell text sizes as they are for now.

When you are done, list what you changed per point, name anything you were not sure about, and confirm that no logic, data or wording changed.

---

## Result (2026-11-25)

- **What the Claude Design assistant reports:**
  - Leftover colours: only 5 old values were left. One was a drawer shadow, now `rgba(16,24,22,.12)`. The other 4 were in the offline-load thumbnail, which cannot take variables, so they are now the new hex values.
  - Charts: one older purple set moved to the `--chart-1…4` ramp. 12 progress tracks and 3 donut rings now use `--border-soft`, and 4 bar fills use `--chart-3`. Radar rings and spokes are `--border-soft`, and the velocity axis labels are 12px `--text-3`.
  - Empty states: 13 blocks are now white cards. None had a heading, so no heading was added.
  - One primary per view: "Export CSV" in the program's All Results tab and "Use this item" in the CGSpace picker are now secondary.
  - Drawer boxes lost the card shadow, and the Settings section titles are 14px/600.
- **Follow-up fix, same day:**
  - The canvas is `--bg` to the bottom of short pages. Results Center showed white under its empty state.
  - Search boxes with an icon show one focus ring, on the outer box, instead of a double frame.
- **Checked on a fresh render at 1440px:** Results Center (empty search, focused search) and the SP01 overview. No page errors, and the console holds the same 24 template placeholders.
- **Still open, for Juanpa to decide:**
  - table cell text at 13px or 14px;
  - several primary buttons inside one drawer's different states;
  - whether the copy replaces the original file.
- **Deadline:** Claude Design's MCP stops by 2026-12-14. Move the project to Claude before then.
