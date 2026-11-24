# Overview: remove the unreachable "Load results into QA" drawer (2026-10-27)

Branch: `jp-design/mockup-completo` · Author: Juanpa (with Claude Code)

## Why
Yeck asked (Slack, 2026-10-27) why the Overview still had the "Load results into QA" drawer when no button opened it. The button was removed on purpose on 2026-10-09 (`5046321`, "drop the load button"): the Overview became more of a dashboard. The drawer and its simulated progress stayed behind as dead code.

## Done
- Deleted `overview/ov-load-drawer.ts`.
- `overview-view.ts` / `.html`: removed the drawer tag, `loadOpen`, the simulated run (`running`, `startRun`, `runningText`, the timer) and the empty header slot that showed "Loading results N of M".
- `overview-calc.ts`: removed `loadEstimate` / `LoadEstimate` and the imports only they used.
- All four files had commits by Juanpa only.

## Tested
- `eslint` on `overview/` exits 0.
- Full suite: 31 files, 260 tests passed.
- Build exit 0.
- Not checked on screen, because the app's sign-in did not work in the app's browser this afternoon. The change removes nothing visible.

## Pending
- `overview.mock.ts` still exports `LOAD_TARGETS`, `LoadTarget`, `LOAD_SUBMITTED`, `LOAD_ALREADY_IN_QA` and `AUTO_APPROVED`, now unused by the Overview. That file also has commits by Yeck, so they are left for him to decide.
