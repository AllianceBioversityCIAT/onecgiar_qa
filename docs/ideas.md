# Ideas under evaluation

🟡/🔴 ideas to review with Yeck (format in `CLAUDE.md` § 4). One per block: date · author · idea · verdict · what is needed.

## 2026-10-08 · Juanpa · Bring the full "QA Platform" mockup into the app

- **Idea:** make the app the full mockup (https://claude.ai/design/p/90941fc5-0cfa-49fb-acdd-2db0ffcd3016): Overview, Results, result review, Cycle, Fields and Assessors, with their drawers.
- **Done** (branch `jp-design/mockup-completo`, with mock data):
  - App frame in `client/src/app/shell/` (sidebar, top bar, user menu, collapse, mobile menu).
  - Shared UI kit in `client/src/app/ui/`, built on `@spartan-ng/brain` primitives: drawer, menu, select, multi-select, switch, segmented control, tabs, tooltip, badge and progress. Tests are in `ui-kit.spec.ts`. The mockup's design tokens (light and `.dark`) live in `ui/tokens/qa-tokens.css` and are applied with the `qa-tokens` class.
  - The 6 views in `client/src/app/pages/workspace/*` work with signals and data from `*.mock.ts`.
  - Routes **added** to `app.routes.ts`: `results`, `results/:code`, `cycle`, `fields` and `assessors`, as children of a `''` layout route guarded by `authGuard`. The existing `''` route for `HomePage` is unchanged; only its template changed, and it now renders `QaShell` + Overview.
- **Verdict:** 🔴 for production (real data, role permissions, QA flow); 🟢 as a working prototype.
- **What a developer needs to do (Yeck / Juanda):**
  1. Replace the `*.mock.ts` files with the API. Each call site is marked `TODO(api)`: load results, publish, invite, save comments and approvals, export. Timelines, programs and result types are duplicated across views and should come from a single service.
  2. Roles: only the mockup's QA lead / assessor view exists today. The review page still needs the lead, broker and PPU modes.
  3. `HomePage.email` and `HomePage.signOut` are now unused, because the user menu lives in `QaShell`. They were left in place because they are Yeck's code.
  4. Fonts: Manrope and JetBrains Mono load through a `<link>` in `shell/qa-shell.html`, because an `@import` in the component CSS breaks the `css-inline-fonts` budget. They belong in `index.html`.
  5. `bundle initial` budget warning (~542 kB > 500 kB). The cause is the temporary `app-palette-switcher`, which pulls spartan input, `@angular/forms` and the CDK overlay into the initial bundle. Wrapping it in `@defer (on idle)` in `app.html` brings it down to ~411 kB (tested; `app.spec.ts` then needs `getDeferBlocks()`). Not applied because those are Yeck's files.
  6. Contrast: the "Pending" badge and some grey texts from the mockup are below WCAG AA (≈ 2.9:1). This is a design decision pending with Juanpa.
  7. The temporary palette switcher (`app-palette-switcher`) covers the bottom-right corner of the views.
