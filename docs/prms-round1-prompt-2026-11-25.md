Edit ONLY the file "PRMS Reporting - QA system.dc.html". Do not touch "PRMS Reporting.dc.html" or any other file.

This is round 1 of aligning PRMS with the QA design system: colours only. Change ONLY the values below, inside the light `:root{…}` block at the top of the file, plus the one `:focus-visible` rule. Keep every variable name exactly as it is. Do not change the `[data-theme="dark"]` block, the markup, the JavaScript, the data, the copy text, or any layout. Do not change the status tokens (`--st-*`), `--danger*`, `--warning*`, `--success`, `--center`, or the program colours (`--prog-*`).

Canvas and surfaces:
--bg: #F4F5F4
--surface: #FFFFFF
--surface-2: #FAFBFA
--surface-3: #F4F6F5
--surface-4: #E9ECEA
--surface-5: #F1F3F2
--surface-6: #D9DEDB
--surface-7: #F4F6F5
--surface-8: #EEF1EF
--surface-9: #FCFDFC
--surface-10: #F2F4F3
--surface-raised: #FFFFFF
--field-bg: #FFFFFF
--seg-track: #E9ECEA
--seg-active: #FFFFFF

Borders:
--border: #E2E6E4
--border-soft: #ECEFED
--border-strong: #CFD5D2
--border-accent: #D5CDEE
--border-raised: #E2E6E4

Text:
--text: #15201E
--text-2: #26302E
--text-3: #4F5A57
--text-4: #5B6663
--text-5: #626D6A
--text-muted: #5F6A67
--text-neutral: #5F6A67

Brand (PRMS purple):
--primary: #5A45B8
--primary-hover: #45348C
--accent: #45348C
--accent-strong: #36296E
--primary-soft: #8B7CD0
--primary-softer: #C2B8EA
--tint: #F4F2FA
--tint-2: #E8E4F5
--tint-3: #D5CDEE
--tint-4: #EDE9F7
--tint-text: #9E8FD6
--tint-soft: #F8F7FC
--tint-border: #E6E3EF
--tint-border-2: #DDD6F2
--band-bg: #F6F5FA
--band-border: #E6E3EF

Sidebar greys (colours only; the selected item comes in a later round):
--nav-bg: #ECEFED
--nav-2: #E2E6E4
--nav-3: #DADFDC
--nav-divider: #DCE1DE
--nav-border: #DCE1DE
--nav-eyebrow: #5B6663
--nav-fg-2: #3F4A47
--nav-fg-3: #5B6663
--nav-scroll: rgba(16,24,22,.18)

Elevation and overlay:
--shadow-pop: 0 8px 24px rgba(16,24,22,.10)
--shadow-seg: 0 1px 2px rgba(16,24,22,.08)
--overlay: rgba(16,24,22,.45)
Add one new variable at the end of the light `:root` block: --shadow-card: 0 1px 3px rgba(16,24,22,.06)

Charts:
--chart-1: #D5CDEE
--chart-2: #9E8FD6
--chart-3: #5A45B8
--chart-4: #2E2266

Focus ring, in the rule `:focus-visible{…}` right after the root blocks:
box-shadow: 0 0 0 3px rgba(90,69,184,.30)

When you are done, list every variable you changed with its old and new value, and confirm nothing outside the light `:root` block and the `:focus-visible` rule was edited.

---

## Result (2026-11-25)

- Sent by Claude Code to the Claude Design assistant, in a new chat on the copy `PRMS Reporting - QA system.dc.html` (project "PRMS Reporting Tool", `b6234307…`).
- **Checked by reading the file:**
  - every value above is in the light `:root` block;
  - `--shadow-card` was added;
  - `:focus-visible` uses `rgba(90,69,184,.30)`.
- **Untouched:** the original `PRMS Reporting.dc.html` keeps its etag `1793290415260451`. The copy grew by one line, the new variable.
- **On screen:** grey canvas, white cards and a grey sidebar.
- **Still to do:** the selected sidebar item is still a purple tint (`--nav-active-bg`); it changes in round 2, sidebar and logo.
