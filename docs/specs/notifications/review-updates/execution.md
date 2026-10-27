# Review updates for the QA Admin (notifications) — Execution Log

## 1. Document Control

| | |
|---|---|
| Spec path | `docs/specs/notifications/review-updates` |
| Branch | `jp-design/mockup-completo` (fast-forwarded to `2904c55`, which includes Yeck's merge of `staging-center`) |
| Approval Mode | gated |
| Leader | Claude Code main session (opus) |
| Implementer / Reviewer | `.claude/agents/akili-implementer.md` (sonnet) / `.claude/agents/akili-reviewer.md` (opus, Read/Grep/Glob) |
| Started | 2026-10-27 |

## 2. Pre-flight (before the first spawn)

**Premise re-check.** The design was verified at `93dfe10`; HEAD is now `2904c55` (Juanpa's Overview dashboard, results paginator, 13 science programs, timeline story refactor; Yeck's merge of `staging-center`). Re-run against HEAD:

| Premise | Result at `2904c55` |
|---|---|
| P-1, P-2, P-21 (top bar, `canAny`, Unsent host) | Hold — `qa-shell.html:96`, `:122`; `qa-shell.ts:82`, `:87-90` |
| P-4, P-16, P-24 (Results reads the snapshot once; setters only set signals) | Hold — `results-view.ts:60`, `:89-97`, `:190-205` |
| P-5 (allowed values) | Changed, not broken: timelines are now `annual`, `jul`, `kp`, `sp03`, `sep` (`results.mock.ts:118-123`) |
| P-7 (exports) | Hold — `results.mock.ts:414`, `:421`, `:424`, `:474` |
| P-11 (count text) | **Changed** — "Showing X of Y" replaced by `qa-pagination` (`results-view.html:69`, total `qa-pagination.ts:38`). Execute-time spec edit below |
| P-12 (ownership) | **Refuted for `results-view.ts`, `results.mock.ts`, `review.mock.ts`**: Yeck authored `042464d` "refactor(lists): one shared table sort" in those files (`git show --stat 042464d`). T-3 only reads the mocks (unchanged scope). **T-2 changes logic in `results-view.ts` → protected under team `CLAUDE.md` § 3.4: needs Juanpa's written confirmation before it starts** |
| P-17, P-25 (review codes) | Hold — 14 codes; `QA-2026-0806`, `QA-2026-0803` are `Automatic` |
| Waiting = 212 | Holds — `results.mock.ts:173`, `overview.mock.ts:186` |

**Execute-time spec edits (no change of meaning):**
- 2026-10-27 · `design.md` P-11 and § 8 *Results re-reads its filters*, `tasks.md` T-2 and T-3 tests: the count is read from the paginator total instead of the removed "Showing … of N" line. Reason: P-11 drift. Carried as a named conformance check in the T-2 and T-3 Reviewer briefs.

**Persona drift.** `akili` CLI not installed, so `akili doctor --agents` cannot run. `.agents/*.md` carry `since=v2.30.0`/`v2.32.0` sections while 2.34.2 templates are installed (already reported in `docs/akili-constitution-check-2026-10-22.md`, gap 3, owner Juanda). Reported to Juanpa; not fixed here (Juanda's files).

## 3. Task Execution History

### T-1: Add an optional grey count to `qa-segmented` — PASS

| | |
|---|---|
| Date | 2026-10-27 |
| Final status | PASS (attempt 1) |
| Requirements covered | FR-2 (Unread only — grey count), FR-9 (count contrast: class pinned; measurement owned by T-7) |
| Skills | angular-developer, tailwind-design-system (task defaults, no deviation) |
| Effort | medium |

**Attempt 1**
- Files changed: `client/src/app/ui/segmented/qa-segmented.ts`, `client/src/app/ui/ui-kit.spec.ts`
- Red run: tests written first on the unchanged component → `Tests 1 failed | 15 passed (16)`; `AssertionError: count element not found: expected null to be truthy` (`ui-kit.spec.ts:160`) — assertion-level; (b) passed as designed.
- Implementer verification: `npx ng test --watch=false --include=src/app/ui/ui-kit.spec.ts && npx ng build` → `16 passed (16)`; build exit 0 (pre-existing budget warning, 603.98 kB initial).
- Falsifiers executed on post-change code and reverted: no `text-(--text-4)` → (a) red `expected false to be true`; `@if (true)` → (b) red `expected 1 to be +0`.
- Evidence re-run (Leader inline, non-author): ui-kit spec `16 passed (16)`; `npx ng build` exit 0, same warning — **VERIFIED**.
- Reviewer (akili-reviewer, opus): **PASS** — scope, FR-2 "plain grey number", DD-14, P-22 and the Disqualifier all hold; `count: 0` still renders; callers unchanged.
- runtime events: none
- Not Done / Assumptions (verbatim summary, no blocker, no owed item): added `&ngsp;` so the DOM text reads "Unread 4"; visual gap from `ml-1`; browser rendering and contrast not verified (owned by T-7); only the ui-kit spec was run.
- ADVISORY (readability): `&ngsp;` plus `ml-1` may give a wider gap than "a space" (design § 8) — compare with the mockup in T-7.
- spawns: implementer 26 calls, 124,265 tokens, ended partial (assumptions only); reviewer 12 calls, 44,630 tokens, ended complete
- Running totals vs budget: tasks 1/7 · LOC ≈ 60/1,100 · review rounds 1/9

### T-3: Add the notification model, mock and store — PASS

| | |
|---|---|
| Date | 2026-10-27 |
| Final status | PASS (attempt 1) |
| Requirements covered | FR-3 (9 types, label words), FR-4 (grouping), FR-5 / NFR-4 (total = Results count, 8 of 8 list targets), FR-7 (read state, no-op mark-all, reload resets), FR-8 (loading / error via `simulate`), NFR-3 (one source, dynamic import) |
| Skills | angular-developer, tdd (task defaults) |
| Effort | high |

**Attempt 1**
- Files changed (new): `client/src/app/pages/workspace/notifications/notifications.model.ts`, `notifications.mock.ts`, `notifications-store.ts`, `notifications.mock.spec.ts`, `notifications-store.spec.ts`
- Red run (stubs: empty `NOTIFICATIONS`, no-op store): every test failed on an assertion — e.g. `expected 0 to be greater than 0`, `expected +0 to be 4`, `expected 'loading' to be 'error'`.
- Implementer verification: `Tests 17 passed (17)`; `ng build` exit 0 (pre-existing budget warning); eslint clean.
- Falsifiers executed and reverted: Stage total +1 → `n-01 … expected 145 to be 146`; Program response `timelineId: 'annual'` → `expected undefined to be 'annual'`; "have now been assessed" → (c) red; `QA-2026-0377` → `expected undefined to be defined`; `load()` → `ready` unconditionally → `expected 'ready' to be 'error'`.
- Evidence re-run (Leader inline, non-author): T-3 specs + ui-kit `33 passed (33)`; `npx ng build` exit 0 — **VERIFIED**.
- Reviewer (akili-reviewer, opus): **PASS** — totals computed with Results' rules, (a) renders the real `ResultsView` per entry, (b)–(h) loop over every entry, DD-9 race handled, no static import of the mock.
- runtime events: none
- Not Done / Assumptions (no blocker, no owed item): `@Service` exported by Angular 22.2.1; sentence = `subject + ' ' + text`; single-result timelines follow `RESULTS` (0841 is `jul`, the FR-3 example's "Annual report 2026" is illustrative); `design.md` line refs drifted (Waiting at `overview.mock.ts:186`; timelines now include `kp`, `sp03`) — amended; mock has 11 entries, 4 unread; extra tests beyond (a)…(l).
- ADVISORY: At risk uses "Step 4" (fits the timeline data) where design said "Step 5" — design example amended (decision below); `loadEntry` should read `delta`, not `total`, for the "loaded today" slot; type `timelineId` as `TimelineId | 'all'`; `Notification` shadows the DOM global (consider `QaNotification`); no test asserts FR-4 grouping keys are unique; At risk `step`/`daysLeft` typed by hand. Recorded only — not new tasks.
- Decisions made: 2026-10-27 · `design.md` § 5 per-type table, At risk row: "Step 5" → "Step 4" (the broker step closing on 23 Jul in the data at `2904c55`). Example only, no change of meaning. `design.md` § 5 `timelineId` row and rules paragraph line refs updated (P-5 drift).
- spawns: implementer 40 calls, 203,456 tokens, ended partial (assumptions only); reviewer — calls/tokens not reported by host, ended complete
- Running totals vs budget: tasks 2/7 · LOC ≈ 640/1,100 · review rounds 2/9

### T-4: Build the notification row and list — in progress

**Attempt 1 — FAIL**
- Files changed (new): `client/src/app/pages/workspace/notifications/notification-row.ts`, `notification-list.ts`, `notification-list.spec.ts`
- Red run (stub components): 15 of 15 failed on assertions or missing elements (e.g. `expected [] to deeply equal [ 'Today', 'Yesterday', 'Earlier' ]`).
- Implementer verification: `15 passed (15)`; build exit 0 (budget warning, initial 604.71 kB).
- Falsifiers executed and reverted: `--danger` on every type → (c) red; timeline in panel → (b) red; `--text-muted` on meta → (h) red.
- Evidence re-run (Leader inline): `15 passed (15)`; build exit 0 — VERIFIED.
- Reviewer: **FAIL** —
  1. `notification-row.ts:4` statically imports `TIMELINES` from `results.mock.ts` (which builds `RESULTS` on load) → violates DD-1, DD-2, NFR-3. Remediation: optional `timelineName` input on the row (page only), `timelineNames` map input on the list, built by the lazy page.
  2. Loading placeholders are not the height of real rows (≈ 58 px held at `min-h-[60px]` vs ≈ 62–89 px rows); test (f) only checks a class → violates FR-8 "same height" and the presence-assertion rule. Remediation: build placeholders from the row's own box per variant (two sentence lines + meta line + page action slot); height equality measured in T-7 or recorded as a gap.
- ADVISORY: `emptyKind` default `'unread'` loops on an empty All view — make it required or add an `'all'` kind (copy is an open question); sentence/action are `<button>`s where design says "link" — revisit in T-5/T-6. Extra API (`emptyKind`, `emptyAction`, `state`) accepted.
- Leader decision: extra API accepted (FR-8 needs the empty-state actions). Effort bumped medium → high for attempt 2.
- runtime events: none

**Attempt 2 — PASS**
- Files changed: same three files (rework in place).
- Changes: no mock import in row or list (`timelineName` input on the row, page only; `timelineNames` map on the list); placeholders built from the row's exported box per variant (`ROW_BOX`, `ROW_META`, `ROW_ACTION_PLACE`), `min-h-[60px]` removed; `emptyKind` gains `'all'` ("No notifications yet", no action), default `'all'`.
- Implementer verification: `18 passed (18)`; build exit 0; eslint clean.
- Falsifiers executed and reverted: F1–F3 as attempt 1 (red); F4 placeholder `py-5` → (f) red; F5 `min-h-[60px]` back → (f) red; F6 line box `h-[1.2em]` → (f) red. Source-grep falsifier skipped (`?raw` unsupported, no node types in `tsconfig.spec.json`).
- Evidence re-run (Leader inline): `grep -n "results.mock\|review.mock"` in row and list → 0 hits; `18 passed (18)`; build exit 0 (604.76 kB initial) — **VERIFIED**.
- Reviewer: **PASS** — FAIL 1 fixed; FAIL 2 fixed structurally (the (f) test reads the line height from the rendered row); attempt-1 points all hold.
- **Gap (FR-8 "same height"):** height equality is not measured in jsdom → owned by T-7 (Playwright, both variants, 390 and 1440 px; a one-line page row at 1440 may be ~21 px shorter than the two-line placeholder — measure and record as match or accepted variance).
- ADVISORY: add the "No notifications yet" state to design § 8 (done, decision below) — ux-ui § 6 also asks for a "why" line; test (b) could use the literal "Annual report 2026" instead of importing `TIMELINES` in the spec; `timelineNames` wiring untested end to end until T-6.
- Decisions made: 2026-10-27 · `design.md` § 8 Page states: added "nothing at all → No notifications yet (no action)", the list takes the empty kind as input. Detail of FR-8's existing "empty state", no change of meaning.
- **Forward pointers:** T-6 — build `timelineNames` from `TIMELINES` + `all` → "All timelines"; pass `emptyKind` (`unread` / `no-match` / `all`); spec asserts a page row shows the resolved timeline name. T-5 — the panel passes no `timelineNames`; pass `emptyKind` (`unread` when the Unread switch is on, else `all`). T-7 — measure placeholder vs real row height (see gap).
- spawns: implementer#1 32 calls, 167,146 tokens, ended partial; reviewer#1 17 calls, 66,031 tokens, ended complete (FAIL); implementer#2 39 calls, 153,864 tokens, ended partial (assumptions + recorded gap); reviewer#2 — not reported by host, ended complete
- Running totals vs budget: tasks 3/7 · LOC ≈ 1,230/1,100 (new files incl. tests: T-1 60, T-3 ~580, T-4 ~590) · review rounds 4/9

### Integrity note — 2026-10-27

While closing T-4, `tasks.md` already showed `[x]` for **T-2** and **T-6**, which have no code in the tree (`results-view.ts` unchanged, no `notifications` route), no `execution.md` entry and no Reviewer PASS. Cause not identified (no Leader write targeted them; no worker was given `tasks.md` in scope). Both reset to `[ ]`. T-1, T-3 and T-4 keep `[x]` — each has its PASS entry above.

### Budget tripwire — 2026-10-27

After T-4: LOC ≈ 1,230 against a budget of ~1,100 (3 of 7 tasks), projected ≈ 2,300. Cause: tests are ~55 % of the lines (more thorough than estimated), the 11-entry mock, and the T-4 rework. Review rounds 4 of 9 (within budget). The Leader reported it late: T-6 had already been spawned. Juanpa (chat, 2026-10-27): "continua" — continue past the budget. T-2 still waits for the written confirmation "confirmo cambiar la lógica de results-view.ts" (team `CLAUDE.md` § 3.4).

### T-6: Add the Notifications page and its route — in progress

**Attempt 1 — FAIL**
- Files changed: `client/src/app/app.routes.ts` (+3 lines, additive), new `client/src/app/pages/workspace/notifications/notifications-view.ts`, `.html`, `.spec.ts`, `client/src/app/app.routes.spec.ts`
- Red run: route without `permission` → `(f) … expected undefined to be 'ADMIN_ACCESS'`; page tests red on assertions with an empty component.
- Implementer verification: `15 passed (15)`; build exit 0; lazy chunk `notifications-view 18.00 kB`.
- Falsifiers executed and reverted: `nav` added → (f) + `nav-items.spec.ts` red; case-sensitive search → (b) red; `permission` dropped → (f) red.
- Evidence re-run (Leader inline): `15 passed (15)`; build exit 0; `app.routes.ts` diff only `+` lines — VERIFIED.
- Reviewer: **FAIL** — the search input uses `placeholder:text-(--text-muted)` (and the icon `stroke="var(--text-muted)"`), copied from Results; violates design § 8 *Tokens used* ("Not `--text-muted` for any text in this feature") and FR-9 contrast. Remediation: `--text-4` in `notifications-view.html` only; optional class assertion in the spec.
- ADVISORY: `simulate()` persists app-wide after `?mock=error` until "Try again" (acceptable under DD-9; note in T-7); test (c) asserts the count's presence, not its color; no page-level test for `emptyKind === 'all'`; CDK `BreakpointObserver` as an alternative to the `matchMedia` signal.
- Not Done / Assumptions (attempt 1, no blocker): no browser check (T-7); "Mark all as read" disabled when nothing unread; Clear filters keeps All/Unread; search over subject + text + timeline name; spec stubs `ResizeObserver`.
- Effort bumped medium → high for attempt 2.
- runtime events: none

**Attempt 2 — FAIL**
- Files changed: `notifications-view.html` (search icon and placeholder → `--text-4`), `notifications-view.spec.ts` (new test (h)).
- Red run: (h) before the fix → `expected 2 to be +0`; falsifier → `expected 1 to be +0`, reverted.
- Evidence re-run (Leader inline): `grep -c text-muted notifications-view.html` → 0; `16 passed (16)`; build exit 0 — VERIFIED.
- Reviewer: **FAIL** — (1) the timeline options' `tag` ("Official"/"Sub") renders in `--text-muted` once a timeline is chosen (`qa-select.ts:122-123`); (2) the open timeline panel shows "Search timelines" and the group headings in `--text-muted` (`qa-select.ts:163`, `:172`); test (h) never selects a timeline nor opens the menu. The placeholder lives in the shared `ui/select/qa-select.ts`, outside T-6's scope.
- ADVISORY: check `document.body.innerHTML` (overlay included) instead of `class`/`stroke` only; rename (h) to the states it covers.
- **Spec tension (Pivot evidence, lightest):** design § 8 *Page* uses `qa-select appearance="inline"` with groups and search, and § 8 *Tokens used* forbids `--text-muted` text in this feature; the shared `qa-select` renders its tag, group headings and search placeholder in `--text-muted`. Both clauses cannot hold without changing a shared UI component. Presented to Juanpa as an amendment choice before attempt 3.
- runtime events: none
- **Decision (Juanpa, chat, 2026-10-27): "Arreglarlo en el selector"** — fix the contrast inside the shared selectors instead of working around them. Execute-time spec edit: `tasks.md` T-6 Scope now names `ui/select/qa-select.ts` and `ui/multi-select/qa-multi-select.ts` (shared boundary, per `tasks.md` execution conventions), design-only: `--text-muted` text → `--text-4` app-wide. Ownership: `qa-multi-select.ts` Juanpa only; `qa-select.ts` Juanpa plus a lint commit by Yeck (`P2-3992`) — a color-only change is allowed by team `CLAUDE.md` § 3.4 ("cambiar el diseño … siempre que no cambie cómo funciona"). Side effect accepted: Results, Fields and Cycle selectors gain contrast too. Effort bumped high → xhigh for attempt 3 (last).

**Attempt 3 — PASS**
- Files changed: `client/src/app/ui/select/qa-select.ts` (5 lines), `client/src/app/ui/multi-select/qa-multi-select.ts` (3 lines) — `text-(--text-muted)` → `text-(--text-4)` only; `notifications-view.spec.ts` (h) → 12 cases (4 states × closed / timeline menu open / Type menu open) on `document.body.innerHTML`; `ui-kit.spec.ts` new "UI kit selectors contrast".
- Red run (before the component change): `Tests 7 failed | 30 passed (37)`, all on `not.toContain('--text-muted')`.
- Falsifier: `text-(--text-muted)` back on the qa-select group heading → `5 failed`, reverted.
- Implementer verification: `44 passed (44)` (4 files); full suite `29 files, 247 passed`; build exit 0 (605.12 kB, budget warning).
- Evidence re-run (Leader inline): `grep -c text-muted` on both selectors and the page → 0, 0, 0; full suite `247 passed (247)`; build exit 0; selector diff = 8 + 8 lines, token swap only — **VERIFIED**.
- Reviewer: **PASS** — design-only change within the amended scope; tests reach the overlay and the chosen-timeline state with guards against an empty pass; `--text-4` contrast from token values: light 5.17:1 (`--surface-3`), 5.53:1 (`--field-bg`, `--surface-raised`); dark 5.92 / 6.31 / 6.08:1 — all ≥ 4.5:1 (computed from tokens, not measured in a browser; T-7).
- ADVISORY: assert the first panel closed before opening the second in the ui-kit test; `qa-menu.ts:132`, `qa-tabs.ts:85`, `qa-date-picker.ts:60`, `qa-pagination.ts:63`, `qa-badge.ts:25` still use `--text-muted` text (not rendered by this feature) — to log in `docs/ideas.md` for a kit-wide contrast pass (recorded, not a task here).
- Side effect (accepted by Juanpa): Results, Fields, Cycle, Assessors and Overview selectors now show tags, placeholders and group headings in `--text-4`.
- spawns: implementer#1 46 calls, 194,767 tokens, ended partial; reviewer#1 15 calls, 56,739 tokens, ended complete (FAIL); implementer#2 11 calls, 112,391 tokens, ended partial; reviewer#2 13 calls, 47,503 tokens, ended complete (FAIL); implementer#3 20 calls, 144,836 tokens, ended partial; reviewer#3 — not reported by host, ended complete
- Running totals vs budget: tasks 4/7 · LOC ≈ 1,800 (over budget, continuation approved by Juanpa) · review rounds 7/9

### T-2: Make Results re-read its filters on every navigation to it — in progress

- **Written confirmation (team `CLAUDE.md` § 3.4):** Juanpa, chat, 2026-10-27: "confirmo cambiar la lógica de results-view.ts". Context given before: `git blame -L 60,100` → 39 lines Juanpa, 2 lines Yeck (`sort`, `sortKey`, commit `042464d`, shared TableSort) — the change touches only the filter-reading lines; Yeck's TableSort lines stay untouched. Recommend telling Yeck when it lands.

**Attempt 1 — PASS**
- Files changed: `client/src/app/pages/workspace/results/results-view.ts` (+52 / −10: `readFilters()` shared by the constructor seed and a `NavigationEnd` subscription keyed to the `/results` path), new `results-view.spec.ts`.
- Red run (current code): (a) `expected 180 to be 40`, (b) `expected 1330 to be 180` — the old N stays; `Tests 4 failed | 2 passed (6)`.
- Implementer verification: `6 passed (6)`; build exit 0; full suite `30 files, 253 passed`.
- Falsifiers executed and reverted: re-seed disabled → (a)(b) red; URL write in `clearFilter` → (c) red (extra `/results?x=1` navigation).
- Evidence re-run (Leader inline): full suite `253 passed (253)`; build exit 0 (605.32 kB); `git diff -U0 results-view.ts | grep -i sort` → 0 hits (Yeck's TableSort lines untouched) — **VERIFIED**.
- Reviewer: **PASS** — no URL write (test (c) checks every `NavigationStart`), path match excludes `/results/:code`, first load unchanged for Overview links and `?status=`, cleanup via `takeUntilDestroyed`, Disqualifier met (same instance, rendered paginator total).
- ADVISORY: the first-load `NavigationEnd` re-set writes new array references and resets `page` to 1 (harmless today; add `equal` or skip when unchanged if page state is ever restored); `'results'` literal duplicated from `app.routes.ts` (spec declares its own route — a rename would silently disable the re-seed); sort is kept when the view is reused (count unaffected); test subscription not unsubscribed.
- Accepted behavior change (design reversion challenge (e)), pinned by test (d): the sidebar "Results" link on a filtered list shows the unfiltered list.
- **Tell Yeck** when this lands: he authored the TableSort lines in the same file (`042464d`).
- spawns: implementer 34 calls, 130,495 tokens, ended partial (assumptions only); reviewer — not reported by host, ended complete
- Running totals vs budget: tasks 5/7 · LOC ≈ 2,010 (over budget, continuation approved) · review rounds 8/9

### T-5: Add the bell and its panel to the top bar — PASS

| | |
|---|---|
| Date | 2026-10-27 |
| Final status | PASS (attempt 1) |
| Requirements covered | FR-1 (all scenarios; "no gap" structural), FR-2 (open/close/Escape/focus return with the real popover, Unread, View all, phone link), FR-5 (row activation closes and navigates), FR-7 (open one), FR-9 (keyboard path, partially — see gap) |
| Skills | angular-developer, tailwind-design-system, frontend-design |
| Effort | high |

**Attempt 1**
- Files changed: new `client/src/app/pages/workspace/notifications/notifications-bell.ts`, `notifications-bell.spec.ts`; `client/src/app/shell/qa-shell.html` (+1 line), `client/src/app/shell/qa-shell.ts` (+1 import line; the `imports: [...]` array line gains `NotificationsBell`).
- Red run (empty component): 9 of 9 failed — (c) on its assertion, the others on null element lookups. Reviewer accepted it: the falsifiers prove the assertions themselves go red.
- Falsifiers executed and reverted: host `contents` removed → (c) red; `pop.close()` removed → (d)(e) red; extra query param on navigation → (g) red (sidebar state).
- Implementer verification: bell spec `9 passed (9)`; full suite `31 files, 262 passed`; build exit 0, initial 605.32 → 606.04 kB.
- Evidence re-run (Leader inline): full suite `262 passed (262)`; build exit 0; shell diff = the three lines above — **VERIFIED**.
- Reviewer: **PASS**.
- Decisions made: the one-line `imports: [...]` change in `qa-shell.ts` counts as "additions only" under team `CLAUDE.md` § 3.4 (a token added, nothing removed; Angular needs it to compile the tag). T-5's Done-when wording ("only added lines") was too narrow.
- **Gap carried to T-7 by name:** P-13 (focus moves into the panel on open) and P-14 (tokens and `.dark` inside the real overlay) were not checked in a browser; closing by outside click and by pressing the bell again are untested.
- ADVISORY: assert the bell exists before using it in (a); (a) only looks inside the button for "4"; hover ring `--surface-4` and icon `--text-3` not listed in design § 8 *Tokens used* — record in T-7; the `imports:` line may conflict if Yeck edits it — mention in the hand-off.
- Issue found by the Leader's lint run (not in any task gate; CI does not run lint): `notifications-view.spec.ts:53` has 3 `@typescript-eslint/no-empty-function` errors (empty `ResizeObserver` stub methods, from T-6). To fix before pushing.
- spawns: implementer 45 calls, 216,903 tokens, ended partial (assumptions only); reviewer — not reported by host, ended complete
- Running totals vs budget: tasks 6/7 · LOC ≈ 2,240 (over budget, approved) · review rounds 9/9 (at budget; T-7 will exceed it by one)

### T-7: Browser check with Juanpa and docs — in progress

| | |
|---|---|
| Date | 2026-10-27 |
| Status | In progress: browser evidence recorded; Juanpa's visual sign-off and the docs are pending |
| Route | Leader inline in the desktop app's browser pane; dev server `ng serve --build-target onecgiar-qa:build:test --port 4200` (already running); Juanpa signed in himself |

**Browser evidence (2026-10-27)**
- Page `/notifications` loads for the admin account; 11 rows in Today / Yesterday / Earlier.
- Bell panel (≥640 px): it opens, and focus moves into the panel ("Mark all as read") — **P-13 met**. `.qa-tokens` is on the overlay, and with `.dark` the panel turns dark like the page — **P-14 met**. Clicking outside closes it; clicking the bell again closes it (`aria-expanded="false"`); in both cases focus returns to the bell.
- Phone (390×844): the bell is an `<a href="/notifications">`, 40×40 px; no horizontal scroll. Tablet (768×1024): the bell is the popover; the panel spans x 156–556 and y 52–612, inside the viewport; no horizontal scroll.
- Contrast (lowest measured ratio per text token, across the page and the open panel):
  - Light: lowest is 4.77, on `--text-4` (the Unread count) and `--text`.
  - Dark: lowest is 6.08, on `--text-4` ("Today").
  - Every text token is ≥ 4.5:1 (AA).
- Notification → Results counts:
  - "145 results … Round 1" → `/results?timeline=annual&stage=r1-two` → "Showing 1–25 of 145".
  - From the open Results page, "Step 4 … 256" → `stage=r2-pending` → "of 256", and the panel closes.
- Sidebar (DD-11, P-27):
  - Collapsed (64 px), then the notification whose target is the current URL: it stays at 64 and the total is restored.
  - After "Clear all" (989), the same notification brings back 145, and the sidebar stays at 64.
  - A notification whose target is a different URL re-expands it (260). This is the shell's existing `linkedSignal` over the URL (P-27); clicking any sidebar link does the same. Expected by design § DD-11, not a defect.
- Overview → Results:
  - All 7 stage links are unchanged by T-2: 148, 200, 71, 180, 334, 40, 357.
  - All 7 result-type links show each type's total: 134, 406, 103, 319, 236, 88, 44.
- Loading placeholder (`?mock=loading`):
  - Panel: placeholder 81.8 px = a real two-line row, 81.8 px. Real one-line rows are 62.3 px.
  - Page at 390 px: placeholder 132.8 px = a real two-line row, 132.8 px.
  - **Page at 1440 px: placeholder 88.8 px vs every real row 67.8 px.** At that width no sentence wraps, so the list shrinks by 21 px per row when it loads. This meets the design (the placeholder matches a two-line row) but is visible. Design call for Juanpa.
- Not checked in the browser:
  - Non-admin "no gap": no non-admin account in this session. Covered structurally by the T-5 test (c).
  - 1024 px.
  - Whether a `?mock=` state persists across in-app navigation: each check here was a full page load, which gives a fresh store.
- **Fix from the check (Juanpa: "decide como sea mejor", 2026-10-27):** on the page, from 640 px the placeholder hides its second sentence line box (`PAGE_WIDE_SECOND_LINE = 'sm:hidden'` in `notification-list.ts`); the panel keeps two. Row heights measured first: at 640 px 7 of 11 rows are one line, at 1024 10 of 11, at 1280+ all 11; at 390 most are two.
  - The placeholder test (f) in `notification-list.spec.ts` now pins it: on the page the second line box has `sm:hidden`; in the panel neither does.
  - Notifications tests `64 passed (64)`. Build exit 0, initial 606.04 kB (the budget warning was already there).
  - Measured after the fix:

    | Where | Placeholder | Real row |
    |---|---|---|
    | Page, 1440 px | 67.8 px | 67.8 px |
    | Page, 640 px | 67.8 px | most rows, one line |
    | Page, 390 px | 132.8 px | 132.8 px, two lines (unchanged) |
    | Panel | 81.8 px | 81.8 px, two lines (unchanged) |
  - Leader inline: one file plus its test, a design-only change. No Reviewer: the review rounds are already at budget.
- **Defect found by Juanpa in the browser** ("pero no me aparece nada en notifications", 2026-10-27):
  - Symptom: `/notifications` stayed on the loading placeholders after he had been on `?mock=loading`.
  - Root cause: `NotificationsView` read `?mock=` once, from the route snapshot. The store is a root singleton, and the router reuses the view when only the query changes, so nothing ended the simulated state. Leaving the page left the bell stuck on it too. This is the "`?mock=` persistence across in-app navigation" item listed above as not checked.
  - Fix: the view subscribes to `queryParamMap` (`takeUntilDestroyed`). A query without `?mock=` ends a simulation the page started (`store.retry()`), and so does closing the page (`DestroyRef`).
  - Two new tests in `notifications-view.spec.ts`: dropping `?mock=` shows the rows; destroying the page in `?mock=error` leaves the store `ready`.
  - Falsifier: with both `retry()` calls disabled, the two tests fail (`2 failed | 20 passed`). Restored: notifications tests `66 passed (66)`. Build exit 0.
  - Browser:
    - `?mock=loading` → bell → "View all notifications" → `/notifications` shows 11 rows (was 4 placeholders).
    - `?mock=error` → sidebar Overview → the bell panel shows 8 rows, no error.
  - Leader inline: one file plus its spec. No Reviewer: the review rounds are at budget.
- **Close (2026-10-27): T-7 PASS, with gaps reported**
  - Juanpa saw the bell, panel and page in the browser ("si", after the stuck-loading fix).
  - **Priority:** Juanpa, from the team meeting: the section is provisional and not a priority; he will adjust it after talking with María Julia.
  - Docs:
    - `docs/ux-ui/design.md`: § 4 adds Notifications; § 5 adds the bell, phone link and sidebar behavior; § 13 adds OQ-1, OQ-2, OQ-6, OQ-7 and the remaining `--text-muted` kit parts.
    - `docs/ideas.md`: priority recorded.
    - New work note `docs/notifications-2026-10-27.md`.
  - Lint: the 3 `no-empty-function` errors in `notifications-view.spec.ts` are fixed. `eslint` on every file the feature touched exits 0.
  - Full suite `31 files, 264 passed (264)`. Build exit 0, initial 606.04 kB (+0.72 kB over the 605.32 kB baseline; NFR-2 ≤ 5 kB met).
  - Impact review (team `CLAUDE.md` § 3.5), files Yeck also edited:
    - Additions only: `app.routes.ts` +3/−0; `qa-shell.html` +1; `qa-shell.ts` gains one import and one token in `imports:`; `qa-segmented.ts` +5; `ui-kit.spec.ts` +109.
    - Class tokens only: `qa-select.ts`, 5 lines.
    - Logic change: `results-view.ts`, confirmed in writing.
  - Gaps, accepted:
    - No non-admin account in this session, so the "no gap" case was not measured in a browser (it is covered by a unit test).
    - The T-7 falsifier (480 px panel at 390) was not run, because below 640 px the bell is a link with no panel.
    - No AXE tool is installed.
    - Tokens `--surface-4` and `--text-3` are not yet listed in the UX design's token section.
  - Running totals vs budget:
    - Tasks 7/7.
    - LOC ≈ 2,300 (over budget, approved).
    - Review rounds 9/9: the T-7 fixes were Leader inline, with no Reviewer.
