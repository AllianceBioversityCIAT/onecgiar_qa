# Review updates for the QA Admin (notifications) — Tasks

> Mock phase, `client/` only. Branch `jp-design/mockup-completo`. Commits use the team format, module `notifications` (or `results`, `ui`, `shell` for those files), e.g. `✨ feat(notifications): add the notifications store and mock`.

## Dependency graph

```
T-1 (qa-segmented count) ──┐
T-2 (Results re-seeds) ────┼──► T-5 (bell + panel) ──┐
T-3 (model, mock, store) ──┤                         ├──► T-7 (browser check + docs)
         └──► T-4 (row, list) ─┴──► T-6 (page + route) ┘
```

T-1, T-2 and T-3 are independent (different files). T-4 needs T-3's model. T-5 needs T-1, T-2, T-3, T-4. T-6 needs T-1, T-3, T-4. T-7 runs last.

**Verification commands** (from `AGENTS.md`): build `cd client && npx ng build`; tests `cd client && npx ng test --watch=false` (one file: add `--include=<path>`). The test environment is jsdom (`client/package.json:47`): it cannot measure layout or contrast, so those checks live in T-7.

**Baseline reds.** For new files the first red is the new spec failing on its own assertion before the code exists; the Implementer quotes that red in `execution.md` before writing the code. A red from "module not found" is not accepted as a red run (it never reaches the assertion): the Implementer creates the empty export first, then observes the assertion fail.

---

## T-1: Add an optional grey count to `qa-segmented`
- **Status:** [ ]
- **Size:** S
- **Depends on:** none
- **Requirements:** FR-2 (Scenario: Unread only — "the switch reads 'Unread 4' with the count as a plain grey number"); FR-9 (Scenario: Widths and themes — contrast ≥ 4.5:1 for the count)
- **Design refs:** design.md § 8 *`qa-segmented` count*, DD-14, P-22
- **Scope:** `client/src/app/ui/segmented/qa-segmented.ts` only: `QaSegmentedOption` gains optional `count?: number`; when set, the label renders the label, a space, and the count in `--text-4`, regular weight, tabular figures, in both active and inactive states. Options without `count` render exactly as today. Not touched: callers (`step-drawer.ts`, `fields-row.*`, `ui-gallery.ts`).
- **Tests:** `client/src/app/ui/ui-kit.spec.ts` — (a) an option with `count: 4` renders "Unread" and a separate element with text "4" carrying the `--text-4` class; (b) an option without `count` renders no count element and the same label text as before.
- **Verification:** `cd client && npx ng test --watch=false --include=src/app/ui/ui-kit.spec.ts && npx ng build`
- **Falsifier:** render the count with the label's own classes (no `--text-4` class) → test (a) red; render a count element even when `count` is undefined → test (b) red.
- **Red run:** tests (a) and (b) run before the change: (a) fails on "count element not found"; (b) passes (it pins today's behavior) — quote both in `execution.md`.
- **Disqualifier:** a test that only checks the text "Unread 4" as one string proves nothing about the grey color; a test that queries by a class the implementation also uses for the label proves nothing about separation.
- **Consumers:** `grep -rln "qa-segmented\|QaSegmented" client/src/app` → `pages/workspace/cycle/step-drawer.ts`, `pages/workspace/fields/fields-row.html`, `pages/workspace/fields/fields-row.ts`, `ui/index.ts`, `ui/ui-gallery.ts`, `ui/ui-kit.spec.ts` (all pass `{ value, label }` only; must stay unchanged)
- **Review:** checklist — one optional field on a shared UI component, backward compatible
- **Done when:** both tests green; build green; no caller file changed.
- **Skills:** angular-developer, tailwind-design-system

## T-2: Make Results re-read its filters on every navigation to it
- **Status:** [ ]
- **Size:** M
- **Depends on:** none
- **Requirements:** FR-5 (Scenario: Stage notification to Results — "AND IT MUST be a deep link: opening the same URL in a new tab shows the same filter and count"; the same-URL case after a manual filter change); NFR-4
- **Design refs:** design.md § 8 *Results re-reads its filters on navigation*, DD-11, P-16, P-23, P-24, P-26, P-27
- **Scope:** `client/src/app/pages/workspace/results/results-view.ts`: on every `NavigationEnd` whose path is `/results`, re-seed `timelineId`, `stages`, `search`, `programs`, `types`, `assessors`, `statuses` from that event's URL with the existing allowed-value rules (`listParam`, timeline fallback). First load unchanged. Results must **not** write to the URL. Not touched: `qa-shell.*`, `app.config.ts`, `results-view.html` (unless a test id is needed), `results.mock.ts`.
- **Tests:** new `client/src/app/pages/workspace/results/results-view.spec.ts` with the real router (`provideRouter` with a `results` route): (a) open `/results?stage=r1-two`, then navigate to `/results?stage=r2-assessed` → "Showing … of N results" shows the new N; (b) open `/results?stage=r1-two`, change the stage filter by hand (set the signal through the component's own setter or menu), navigate to `/results?stage=r1-two` with `onSameUrlNavigation: 'reload'` → the count returns to the `r1-two` count; (c) after (a) and (b), `router.url` never changed except by the test's own navigations (no URL writes).
- **Verification:** `cd client && npx ng test --watch=false --include=src/app/pages/workspace/results/results-view.spec.ts && npx ng build`
- **Falsifier:** remove the `NavigationEnd` re-seed (keep only the snapshot) → (a) and (b) red with the old count; add a `router.navigate` that writes filters to the URL → (c) red.
- **Red run:** run (a) and (b) on the current code before the change: both fail on the count assertion (old N stays) — quote it in `execution.md`.
- **Disqualifier:** a test that re-creates the component for each URL (new `TestBed` fixture per navigation) never exercises reuse, so its green proves nothing; a test that reads the signal directly instead of the rendered "Showing … of N" text does not prove what she sees.
- **Consumers:** `grep -rn "ResultsView\|results-view" client/src --include=*.spec.ts` → 0 hits (P-16); Overview deep links `ov-cycle-hero.ts`, `ov-attention.ts`, `ov-work.ts`, `overview-view.ts` (navigate to `/results?...` from another route — must keep working, checked in T-7)
- **Review:** full — behavior change in a routed view that every Overview link reaches
- **Done when:** (a), (b), (c) green; build green; no file outside Scope changed; the accepted change "sidebar Results link shows the unfiltered list" (design.md reversion challenge (e)) is noted in `execution.md`.
- **Skills:** angular-developer, tdd

## T-3: Add the notification model, mock and store
- **Status:** [ ]
- **Size:** M
- **Depends on:** none
- **Requirements:** FR-3 (closed set of 9 types; "IT MUST use the QA stage words … exactly"); FR-4 (Scenario: Many results reach a stage — "BUT it must NOT list 18 separate notifications"); FR-5 (sentence's total = target count); FR-7 (Scenarios: Open one; Mark all as read incl. "IT MUST be a no-op … when nothing is unread"; Reload in the mock phase); FR-8 (Scenario: Loading and error — "IT MUST be possible to show both states with the mock"); NFR-3; NFR-4
- **Design refs:** design.md § 5 (data model, per-type table and rules), § 8 *Sentences*, DD-1, DD-2, DD-3, DD-6, DD-8, DD-9, DD-12, P-4…P-7, P-17, P-18, P-25
- **Scope:** new `client/src/app/pages/workspace/notifications/notifications.model.ts`, `notifications.mock.ts`, `notifications-store.ts`. The mock has 9–12 entries covering all 9 types, mock date 17 Jul 2026, `total` computed from `RESULTS` with Results' rules, `delta` authored, single-result codes from `review.mock.ts` excluding `QA-2026-0806` and `QA-2026-0803`. The store is a `@Service()` root service: `state`, `items`, `unreadCount`, `load()` (dynamic import of the mock), `retry()`, `markRead(id)`, `markAllRead()`, `simulate(state)` (a simulated state is not overwritten by a later `load()` resolving). Not touched: `results.mock.ts`, `review.mock.ts`, `overview.mock.ts`.
- **Tests:** new `notifications.mock.spec.ts`: (a) for every entry with a list target, render `ResultsView` at the target URL and assert "Showing … of `total`"; (b) the target's `timeline` parameter equals `timelineId` and is absent exactly when `timelineId` is `all`; (c) every Stage, Quality assessed and At risk sentence contains its `QA_STAGE_LABELS` words exactly; (d) single-result codes exist in `review.mock.ts` and are not `Automatic`; (e) Load `delta` = `total`; (f) Waiting `total` = 212 (the Overview figure); (g) types used ⊆ the 9 types and every type appears; (h) Stage entries use only `r1-one`, `r1-two`, `r2-assessed`. New `notifications-store.spec.ts`: (i) `unreadCount` after `markRead`; (j) `markAllRead` twice is a no-op without error; (k) `simulate('error')` before `load()` resolves stays `error`; (l) `retry()` from `error` reaches `ready`.
- **Verification:** `cd client && npx ng test --watch=false --include=src/app/pages/workspace/notifications/notifications.mock.spec.ts --include=src/app/pages/workspace/notifications/notifications-store.spec.ts && npx ng build`
- **Falsifier:** change one Stage entry's `total` by +1 (or type it as the mockup's 71 instead of computing it) → (a) red; give a Program response entry `timelineId: 'annual'` → (b) red; write "have now been assessed" instead of the label words → (c) red; use `QA-2026-0377` → (d) red; let `load()` set `ready` unconditionally → (k) red.
- **Red run:** with empty exports in place, (a)…(l) fail on their assertions — quote the failing lines in `execution.md`.
- **Disqualifier:** if (a) computes the expected count with the mock's own helper instead of rendering `ResultsView`, it compares the code with itself and proves nothing; if any list-target entry is skipped by (a), the count is not 100 % of entries (NFR-4).
- **Consumers:** none (no shared symbol changed; the mock only reads `results.mock.ts` and `review.mock.ts` exports, which both export `RESULTS` — import with aliases)
- **Review:** full — the mock is the contract the later API must reproduce, and NFR-4 rests on it
- **Done when:** (a)…(l) green; build green; no component imports `notifications.mock.ts` (only the store's dynamic import).
- **Skills:** angular-developer, tdd

## T-4: Build the notification row and list
- **Status:** [ ]
- **Size:** M
- **Depends on:** T-3
- **Requirements:** FR-3 (Scenario: Reading a notification — bold subject, meta "type · timeline · time", "BUT it must NOT put icons before the type or the sentence"; Scenario: At risk — red only for At risk, "BUT it must NOT color any other type, sentence or count red"); FR-2 (day groups Today / Yesterday / Earlier, newest first); FR-8 (Scenarios: Nothing unread; Filters match nothing; Loading and error — placeholder rows of the same height, error copy and "Try again"); FR-9 (unread dot has a text equivalent)
- **Design refs:** design.md § 8 *Row*, *Page* (states), *Tokens used*, DD-10, S-4
- **Scope:** new `notification-row.ts` (inputs `notification`, `variant`; output `opened`), `notification-list.ts` (day groups with eyebrow labels in `--text-4`, rows, empty / no-match / loading / error states, outputs `opened`, `retry`). Unread rows carry a visually hidden "Unread" text. No `--text-muted` on any text. Not touched: store, mock.
- **Tests:** new `notification-list.spec.ts`: (a) subject inside a bold element, rest regular; (b) meta shows the type label, and the timeline only in `variant="page"`; (c) only the At risk type label carries the `--danger` class — assert on every type; (d) no `svg` or icon element inside a row before the text; (e) items split into Today / Yesterday / Earlier in that order, newest first; (f) each state renders its copy ("No unread notifications" + "Show all"; "No notifications match these filters" + "Clear filters"; 4 placeholder rows; "Couldn't load notifications." + "Try again" emitting `retry`); (g) an unread row contains the hidden "Unread" text; (h) no element uses the `--text-muted` class.
- **Verification:** `cd client && npx ng test --watch=false --include=src/app/pages/workspace/notifications/notification-list.spec.ts && npx ng build`
- **Falsifier:** apply the `--danger` class to every type label → (c) red; render the timeline in `variant="panel"` → (b) red; use `--text-muted` for the meta → (h) red.
- **Red run:** with empty components in place, (a)…(h) fail on their assertions — quote in `execution.md`.
- **Disqualifier:** checking class presence proves the token is applied, not the contrast — contrast is measured in T-7; a test that only covers the At risk row cannot show that other rows are not red (c must loop over all types).
- **Consumers:** none (new components only)
- **Review:** checklist — presentational components with a full spec
- **Done when:** (a)…(h) green; build green.
- **Skills:** angular-developer, tailwind-design-system, frontend-design

## T-5: Add the bell and its panel to the top bar
- **Status:** [ ]
- **Size:** M
- **Depends on:** T-1, T-2, T-3, T-4
- **Requirements:** FR-1 (all three scenarios, incl. "BUT it must NOT show the number as a colored badge", "AND IT MUST keep the existing top-bar controls … in place and working", "BUT it must NOT leave an empty gap"); FR-2 (Scenarios: Open and close — focus moves in, Escape / outside click / bell close and return focus, "BUT it must NOT navigate away or lose the page's state"; Unread only; View all; Panel on a phone); FR-5 (Scenario: Activating the row — target opens and the panel closes); FR-7 (Scenario: Open one, from the panel); FR-9 (Scenario: Keyboard path, "BUT it must NOT trap focus after the panel closes")
- **Design refs:** design.md § 8 *Bell and panel*, DD-4, DD-5, DD-10, DD-11 part 2, P-1, P-2, P-8, P-13, P-14, P-21, P-27, P-28
- **Scope:** new `notifications-bell.ts`: host `class: 'contents'`; renders only with `AccessControl.canAny(ADMIN_ACCESS)`; ≥ 640 px a `<button>` with `BrnPopover` (`role: null` on the pane; content root `role="dialog"`, `aria-label="Notifications"`, `class="qa-tokens"`, `--surface-raised` / `--border-raised`); < 640 px a router link to `/notifications`; dot and accessible name; at most 8 rows; every exit closes the popover, then navigates with `onSameUrlNavigation: 'reload'`. **Additive only** in Yeck's files: one import in `client/src/app/shell/qa-shell.ts`, one `<qa-notifications-bell />` before `<qa-unsent-center />` in `qa-shell.html`. Not touched: any other line of `qa-shell.*`.
- **Tests:** new `notifications-bell.spec.ts`: (a) admin with 4 unread → bell with accessible name "Notifications, 4 unread" and a dot, no element showing "4" on the bell; (b) nothing unread → name "Notifications", no dot; (c) non-admin → no bell element rendered inside the host and the host has `display: contents`; (d) opening a row closes the panel, marks the notification read and navigates to its target; (e) "View all notifications" closes the panel and navigates to `/notifications`; (f) Escape closes and focus returns to the bell button; (g) a shell rendered with `collapsed` set to true keeps it after opening a notification whose target equals the current URL.
- **Verification:** `cd client && npx ng test --watch=false --include=src/app/pages/workspace/notifications/notifications-bell.spec.ts && npx ng build`; first step: open the panel in the browser (dev server on port 4200, per `~/.claude/reglas/frontend-qa.md`) with the keyboard and in `.dark`, to confirm P-13 and P-14 hold in the real overlay.
- **Falsifier:** remove `class: 'contents'` → (c) red; navigate without closing → (d)/(e) red (panel still open); navigate without `onSameUrlNavigation: 'reload'` in (g)'s same-URL case → the Results count assertion in T-2's pattern stays stale, and a URL-writing variant → (g) red.
- **Red run:** with an empty bell component, (a)…(g) fail on their assertions — quote in `execution.md`.
- **Disqualifier:** a test that stubs `BrnPopover` away proves nothing about Escape or focus return — (f) must use the real popover; (c) checking only `@if` output without the host style does not prove "no gap" (the gap is measured in T-7).
- **Consumers:** `grep -rn "qa-shell\|QaShell\|qa-unsent-center\|user-email" client/src --include=*.spec.ts` → 0 hits (P-15); `client/src/app/pages/home/home.ts` (renders `QaShell`)
- **Review:** full — touches the shared shell header seen on every page
- **Done when:** (a)…(g) green; build green; `git diff` of `qa-shell.ts` and `qa-shell.html` shows only added lines.
- **Skills:** angular-developer, tailwind-design-system, frontend-design

## T-6: Add the Notifications page and its route
- **Status:** [ ]
- **Size:** M
- **Depends on:** T-1, T-3, T-4
- **Requirements:** FR-6 (all three scenarios, incl. applied filters removable, case-insensitive search, "BUT it must NOT download the page's code first" for users without access); FR-7 (Scenario: Mark all as read on the page, and the bell / panel / page agree); FR-8 (page states, incl. the `?mock=` switch); FR-2 (Unread view on the page); NFR-2 (page lazy loaded)
- **Design refs:** design.md § 8 *Route*, *Page*, DD-7, DD-9, P-3, P-20
- **Scope:** new `notifications-view.ts` + `notifications-view.html`: header, "Viewing All timelines ⌄" (`qa-select appearance="inline"`), search, Type (`qa-multi-select`), All / Unread (`qa-segmented` with `count`, `layout="fill"` below 640 px), applied-filter chips + "Clear filters", list `variant="page"`, "Mark all as read", `?mock=loading|error`. **Additive only** in Yeck's `client/src/app/app.routes.ts`: one `view('notifications', 'Notifications · PRMS Quality Assurance', { permission: Permission.ADMIN_ACCESS }, …)` child of the shell route, no `nav`. New `client/src/app/app.routes.spec.ts`.
- **Tests:** new `notifications-view.spec.ts`: (a) timeline "July 2026 sub-timeline" + type "Load" → only matching rows, each filter shown as a removable chip; (b) search "sp09" matches "SP09" (case-insensitive) in sentence, subject or timeline; (c) "Unread" shows only unread rows with the grey count; (d) "Mark all as read" → unread count 0 in the store (the bell reads the same store); (e) `?mock=loading` shows 4 placeholder rows, `?mock=error` shows the error and "Try again" recovers. New `app.routes.spec.ts`: (f) the `notifications` route exists under the shell route with `data.permission === ADMIN_ACCESS`, `canMatch` includes `permissionMatch`, and it has no `nav`.
- **Verification:** `cd client && npx ng test --watch=false --include=src/app/pages/workspace/notifications/notifications-view.spec.ts --include=src/app/app.routes.spec.ts --include=src/app/core/access/nav-items.spec.ts && npx ng build`
- **Falsifier:** add `nav: { label: 'Notifications', … }` to the route → `nav-items.spec.ts` red and (f) red; make search case-sensitive → (b) red; drop `permission` from the route data → (f) red.
- **Red run:** before the route exists, (f) fails on "route not found"… after adding an empty route entry without `permission`, (f) fails on the permission assertion — quote that one (assertion-level).
- **Disqualifier:** (f) asserts configuration, not the guard's behavior — the guard itself is covered by the existing `permission-guard.spec.ts`; a user without access is checked in the browser in T-7.
- **Consumers:** `client/src/app/core/access/nav-items.spec.ts:14-22` (pins the admin menu; must stay green — P-20)
- **Review:** full — new route in a shared routing file
- **Done when:** (a)…(f) and `nav-items.spec.ts` green; build green; `git diff` of `app.routes.ts` shows only added lines; the build output lists the page as its own lazy chunk.
- **Skills:** angular-developer, tailwind-design-system, frontend-design

## T-7: Check in the browser and update the docs
- **Status:** [ ]
- **Size:** S
- **Depends on:** T-5, T-6
- **Requirements:** FR-2 (Scenario: Panel on a phone — no horizontal scroll, actions ≥ 40 px); FR-9 (Scenarios: Keyboard path; Widths and themes — no horizontal scroll, no overlap, contrast ≥ 4.5:1, light and dark); FR-1 (no gap for a non-admin, measured); FR-6 (Scenario: No access, in the browser); FR-5 (Overview deep links still open the right count after T-2); NFR-1; NFR-2
- **Design refs:** design.md § 8, § 10; requirements.md § 7 *Defect classes and their gates*
- **Scope:** run the app (`cd client && npx ng serve --build-target onecgiar-qa:build:test --port 4200`) and check with Playwright: at 390, 768, 1024 and 1440 px, light and `.dark`: page `scrollWidth ≤ clientWidth`; the open panel's bounding rect inside the viewport; bell / link and segment heights ≥ 40 px below 640 px; keyboard path bell → panel → row → target; contrast of meta, eyebrow and count text from computed colors (≥ 4.5:1); non-admin view: header controls' x-positions unchanged with and without the bell; Overview's 7 stage links still show 148, 200, 71, 180, 334, 40, 357 in Results. Compare against the mockup frames 1a, 1c, 1d, 1e (T6 visual review). Then update `docs/ux-ui/design.md` (§ 4 Screen Inventory: Notifications; § 5 Navigation: the bell; § 13: OQ-1, OQ-6, OQ-7) and write the work note `docs/notifications-2026-10-22.md` (done / tested / pending).
- **Tests:** none new (browser measurements recorded in `execution.md`).
- **Verification:** manual + Playwright measurements above, each recorded with its number; `cd client && npx ng build` (report the initial and shell chunk sizes against NFR-2).
- **Falsifier:** temporarily set the panel width to 480 px at 390 → the bounding-rect check must report it outside the viewport; if it does not, the check is not measuring.
- **Red run:** n/a (no test gate)
- **Disqualifier:** a screenshot alone is not a measurement; a check run only at 1440 px says nothing about phones; contrast read from token names instead of computed colors does not count.
- **Consumers:** none (no shared symbol changed)
- **Review:** lenses — visual and accessibility judgment at the HITL pause with Juanpa (T6 multimodal)
- **Done when:** every measurement above recorded and passing, or reported as a gap; Juanpa has seen the bell, panel and page in the browser; docs updated.
- **Skills:** angular-developer, frontend-design

---

## Coverage — every scenario and clause has an owner

| Requirement | Scenario / clause | Task |
|---|---|---|
| FR-1 | Admin with unread; "must NOT … colored badge"; "IT MUST keep the existing top-bar controls" | T-5 (a), T-7 |
| FR-1 | Nothing unread | T-5 (b) |
| FR-1 | User without ADMIN_ACCESS; "must NOT leave an empty gap" | T-5 (c), T-7 (measured) |
| FR-2 | Open and close; "must NOT navigate away or lose the page's state" | T-5 (f), T-7 |
| FR-2 | Unread only (count grey) | T-1, T-5, T-6 (c) |
| FR-2 | View all | T-5 (e) |
| FR-2 | Panel on a phone (no horizontal scroll, ≥ 40 px) | T-5 (link), T-7 |
| FR-3 | Reading a notification; "must NOT put icons"; "IT MUST use the QA stage words exactly" | T-4 (a)(b)(d), T-3 (c) |
| FR-3 | At risk; "must NOT color any other type … red" | T-4 (c) |
| FR-4 | Many results reach a stage; "must NOT list 18 separate notifications" | T-3 (h) + mock authoring rule |
| FR-5 | Stage notification to Results; "must NOT compare against the whole-cycle figure"; "IT MUST be a deep link" | T-3 (a)(b), T-2 (a)(b) |
| FR-5 | Activating the row (opens target, panel closes) | T-5 (d) |
| FR-6 | Filter by timeline and type | T-6 (a) |
| FR-6 | Search | T-6 (b) |
| FR-6 | No access; "must NOT download the page's code first" | T-6 (f), T-7 |
| FR-7 | Open one | T-3 (i), T-5 (d) |
| FR-7 | Mark all as read; "IT MUST be a no-op … when nothing is unread" | T-3 (j), T-6 (d) |
| FR-7 | Reload in the mock phase | T-3 (DD-8: signals only) |
| FR-8 | Nothing unread; Filters match nothing | T-4 (f) |
| FR-8 | Loading and error; "IT MUST be possible to show both states with the mock" | T-3 (k)(l), T-4 (f), T-6 (e) |
| FR-9 | Keyboard path; "must NOT trap focus" | T-5 (f), T-7 |
| FR-9 | Widths and themes (scroll, overlap, contrast) | T-4 (h), T-7 |
| NFR-1 | AA; AXE | T-7 (no AXE tool is installed in `client/` — substitute: Playwright accessibility tree + contrast from computed colors; **accepted gap**: no automated AXE run) |
| NFR-2 | Bundle ≤ 5 kB initial growth; page lazy | T-6, T-7 |
| NFR-3 | One data source | T-3 (Done when) |
| NFR-4 | Sentence's total = Results count (and 212 on the Overview) | T-3 (a)(f), T-7 |

## Skip-eligible tasks

None. Every task gets a Reviewer.
