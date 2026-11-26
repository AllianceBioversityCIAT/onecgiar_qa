# Stacked logo in the sidebar (QA and PRMS) — 2026-11-26

## Why

The one-line logo (24 px) left no room for the collapse button, so the button had moved to the top bar. Juanpa drew a two-line version of both logos ("PRMS" on top, the platform word below) and recoloured them: the mark and the platform word take the platform colour, and only "PRMS" stays near-black (#23232A). Four options were compared inside a 260 px sidebar:

- A: one line at 24 px, button in the top bar (as before).
- B: one line plus the button in the sidebar. In QA the logo shrinks to 20 px and "quality assurance" gets hard to read.
- C: two lines at 36 px plus the button. **Chosen by Juanpa.**
- D: two lines at 40 px plus the button. A bit heavy next to the menu.

## What changed

**QA (branch `jp-design/visual-polish`)**

- `client/public/logo-prms-qa.svg`: the stacked logo (488×100), 75 KB. It reuses the cropped mark PNG of the earlier file and the word paths from Juanpa's `Logo PRMS Quality Assurance 2.svg` (1.8 MB with a 3091×4096 embedded image).
  - Mark and "quality assurance" are #0F766E; "PRMS" is #23232A.
- `client/src/app/shell/qa-shell.html`:
  - the logo is shown at 36 px on every screen size;
  - the collapse / expand button is back in the sidebar header, to the right of the logo, and is gone from the top bar. Its right edge lines up with the menu items (12 px from the edge), leaving 19 px between logo and button (it was 11 px; Juanpa found it too close);
  - collapsed, the logo is clipped to the mark (44 px wide) with the button under it;
  - on phones, the close button keeps its place.
- Logic is unchanged: same `toggleMenu()`, labels and `aria-expanded`.

**PRMS (Claude Design, the copy "PRMS Reporting - QA system.dc.html")**

- New assets:
  - `assets/logo-prms-reporting-stacked.png` (345×108, 11,879 bytes);
  - `assets/prms-symbol-purple.png` (128×108, 7,945 bytes).
- The sidebar header shows the stacked logo at 36 px with the collapse button beside it. The button was removed from the top bar.
- Collapsed, it shows the purple mark with the expand button under it. The purple mark replaces `prms-symbol-dark.png`.
- The purple in Juanpa's file is #5A47A8, slightly different from the app's `--primary` #5A45B8. It was kept as he drew it.

## Checked

- `npx ng build`: green. The bundle budget warning was already there.
- `qa-shell.spec.ts`: 3/3 passing.
- QA in the browser, signed in with the design account:
  - desktop 1440 expanded and collapsed;
  - phone 390 with the menu open.
- PRMS on a fresh render at 1440, expanded and collapsed:
  - no page errors;
  - the console has the same template placeholders as before.

## Pending

- The sign-in page (`client/src/app/pages/login/login.html`, last changed by Juanda and Yeck) still shows its own one-line logo with the old purple mark. Changing it would be a visual-only change in a dev-owned file. Not done yet.
- QA change not yet committed or pushed.

## Selected sidebar item (later the same day)

Juanpa felt the white raised row with a shadow looked like a card, not like a selected option. He pointed to Claude's own sidebar, where the selected item is a flat shade.

- **QA:**
  - new token `--nav-active-bg`: #D4DBD8 in light mode, one step darker than hover (#E2E6E4); #243432 in dark mode;
  - `.qa-nav-active` (`shell/qa-shell.css`) uses that token with `--nav-fg` at weight 600: no white background, no shadow, no border;
  - hover over the selected item does not change it;
  - checked on desktop, expanded and collapsed; `ng build` is green.
- **PRMS (the copy in Claude Design):** the same flat #D4DBD8 row, no shadow, in every sidebar group and in the collapsed sidebar. Dark mode uses #33303F.
- **Not committed yet.**
