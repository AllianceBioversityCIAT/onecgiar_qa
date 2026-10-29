# Sidebar active-cycle block: information only (2026-10-29)

Branch: `jp-design/mockup-completo` · Author: Juanpa (with Claude Code) · Earlier notes: `sidebar-ciclo-activo-2026-10-21.md`

## Done
- The "Annual report 2026 · Active / Step 4 of 5 · closes 23 Jul" block at the top of the sidebar is no longer a link to Cycle (Juanpa). Cycle already has its own item in the menu, so the block now only informs.
- In `client/src/app/shell/qa-shell.html` the `<a routerLink="/cycle">` became a `<div>`, and the hover border and focus ring went with it. The look is unchanged. Every line of the block is Juanpa's.
- `docs/ux-ui/design.md` (navigation) now says the block is information only.

## Tested
- In the browser at desktop width: the block is a `div` with no link. Clicking it stays on the Overview, and the cursor is the normal arrow.
- No unit test covers the app frame, so none was run.

## Pending
- Not verified: the mobile menu.
