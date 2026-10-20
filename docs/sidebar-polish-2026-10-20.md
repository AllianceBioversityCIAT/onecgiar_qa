# Sidebar polish — 2026-10-20

Branch: `jp-design/mockup-completo`

## Done
- Active cycle block (`client/src/app/shell/qa-shell.html`): now sits in a contained card (`--surface` background, `--nav-divider` border). Removed the uppercase "ACTIVE CYCLE" eyebrow and the "·" separator. It shows "2026 cycle" with "Active" on the right, and "Round 2, step 5 closes 19 Jul" below.
- Active nav item (`client/src/app/shell/qa-shell.css`): removed the 3px left stripe. Keeps the tint background and 600 weight.
- Group labels ASSESSMENT / ADMINISTRATION stay uppercase (Juanpa's decision).

## Tested
- Dev server (`build:test`, port 4200) compiles with no errors.
- Visual check of the sidebar at 1440px.

## Pending
- (done, see follow-up check)
- `npx ng build` passes (only the existing bundle budget warning).

## Follow-up check (same day)
- Mobile 390: the sidebar drawer shows the cycle card and the active item correctly.
- Dark mode at 1440: the cycle card and the active item read fine. Existing issue, not changed here: the "quality assurance" part of the logo has low contrast on the dark sidebar.
