# Judgment Day — design.md (notifications/review-updates)

| | |
|---|---|
| Target | `design.md` (draft, 2026-10-22) against `requirements.md` and `proposal.md` |
| Mode | Blind dual review, two read-only judges (`akili-reviewer`, Read/Grep/Glob) |
| Round | 2 of 2 (fix round 2 applied; final scoped re-judgment pending) |
| Verdict round 1 | Judge A: FAIL · Judge B: FAIL |
| Decision | Juanpa: fix the 6 confirmed severe + the 7 agreed info items, then re-judge |
| Re-judgment 1 | Judge A: PASS (3 warnings) · Judge B: FAIL (1 severe) — all 13 items fixed by both; new fix-caused gaps below |

## Confirmed severe (both judges)

| ID | Finding | Judges | Evidence |
|---|---|---|---|
| S-1 | `ResultsView` reads its filters once from the route snapshot; opening a "View results" notification while already on `/results` changes the URL but not the list or the count (FR-5). No premise row | A-2, B-1 | `client/src/app/pages/workspace/results/results-view.ts:60`, `:79`, `:89`, `:93-97` |
| S-2 | `ReviewView` only knows the 14 codes of `review.mock.ts` and falls back to the first one; "View result" for any other code opens the wrong result. No premise row | A-5, B-2 | `client/src/app/pages/workspace/review/review-view.ts:116`; `review.mock.ts:119-133` |
| S-3 | FR-4 asks for a total and today's change; `QaResult` has no date, so the change cannot be computed (DD-3) and one `count` field cannot hold both | A-3, B-3 | `results.mock.ts:32-46`; `requirements.md` FR-4 |
| S-4 | `--text-muted` on `--surface` is about 3.0:1, below FR-9's 4.5:1, for meta, eyebrows and grey counts | A-6, B-4 | `client/src/app/ui/tokens/qa-tokens.css:9`, `:24` |
| S-5 | P-14 is false: overlay content gets no tokens unless its root carries `class="qa-tokens"` | A-1, B-6 | `client/src/app/ui/tokens/qa-tokens.css:7`; `qa-tokens.ts:24-29`; `qa-select.ts:146`; `role-cell.ts:36` |
| S-6 | `qa-segmented` has one `label` string per option; the grey "Unread 4" count needs a change to that shared component, not named in the design (it is 26 px tall too, under the 40 px phone minimum) | A-7, B-7 | `client/src/app/ui/segmented/qa-segmented.ts:5-9`, `:65`, `:92`, `:97` |

## Raised by both, not severe in both (info)

| ID | Finding | Judges |
|---|---|---|
| I-1 | No per-type table (type → action → target → which number is compared); Cycle's "Show progress" numbers come from `cycle.mock.ts`, and Program response counts comments | A-4 (severe), B-10 |
| I-2 | Empty bell host still takes a flex gap for non-admins; needs `host: { class: 'contents' }` | A-9, B-5 (severe) |
| I-3 | Popover does not close on navigation; row, action and "View all" must close it first | A-8, B-9 |
| I-4 | `BrnPopover` already sets an unnamed `role="dialog"` on its pane; use `role: null` and name the content root | A-10, B-8 |
| I-5 | Panel should use `--surface-raised` / `--border-raised` like every other popover | A-12, B-14 |
| I-6 | Rule to turn "Round 1 · Assessed by 2 assessors" into the sentence is not defined | A-11, B-17 |
| I-7 | No route-entry test in the directory plan; `nav-items.spec.ts` is a consumer of `app.routes.ts` with no row | A-13, B-15 |

## Suspect (one judge)

| ID | Finding | Judge |
|---|---|---|
| U-1 | NFR-4's Overview equality for all-timeline notifications has no test | B-11 |
| U-2 | Race: the bell's `load()` can overwrite a state the page set with `?mock=error` | B-12 |
| U-3 | Bell is 32 px (needs 40 px on phones); unread dot has no text equivalent | B-13 |
| U-4 | Marking read before navigation resolves; a cancelled navigation still marks it read | B-16 |
| U-5 | `timelineId: 'all'` is not a `TIMELINES` id; its filter behavior is undefined | A-14 |

## Premise Ledger check

P-1…P-11, P-13, P-15 confirmed by both (P-13 with caveats: focus returns only when focus fell to the body; trigger must be a `<button>`). P-12 not re-run by either (no shell). **P-14 contradicted by both** (S-5).

## Ownership (for the fixes)

`git log --format='%an' -- <file> | sort | uniq -c` → `qa-segmented.ts`, `review-view.ts`, `review.mock.ts`, `results-view.ts`: Juan Pablo Bueno only. Fixes in those files stay inside Juanpa's own work.

## Re-judgment 1 → fix round 2

| ID | Finding | Judges | Fix applied in `design.md` / `requirements.md` |
|---|---|---|---|
| R-1 | Same-URL gap: after a manual filter change, opening the same notification does nothing (router ignores same-URL navigation; Results never writes its filters to the URL) | RB-1 (severe), RA-1 (warning) | DD-11 now syncs both ways: URL → state and state → URL with `replaceUrl`; P-23, P-24, P-26 added; spec covers the manual-change case |
| R-2 | Program response and Waiting have no `timelineId` rule while their targets cover every timeline | RB-3, RA-2 | Per-type table sets `timelineId: all`; spec asserts target `timeline` ⇔ `timelineId` |
| R-3 | Load's target shows the whole timeline, not one run; no rule says which number each sentence compares | RB-2, RA-3 | Per-type sentence column; compared number is always `total`; Load limited to the first load of a timeline (requirements FR-4 table updated) |
| R-4 | NFR-4 compares "the number in the sentence" though sentences now carry a delta | RB-4 | NFR-4 measure: the sentence's total, never its change |
| R-5 | At risk stage left open ("or the stage at risk") | RB-5 | Stage named in the mock entry; sentence rule covers At risk |
| R-6 | Requirement examples used the mockup copy, not the DD-6 sentence | RB-6 | Glossary and FR-5 examples aligned |
| R-7 | Two allowed review codes are `Automatic` | RA-4 | DD-12 excludes `QA-2026-0806`, `QA-2026-0803` (P-25) |
| R-8 | Split rule produces "reached Pending" | RA-5 | Stage notifications limited to assessed stages |

## Re-judgment 2 (final) → ESCALATED

| | Judge A | Judge B |
|---|---|---|
| Verdict | FAIL (1 severe) | PASS (2 warnings) |
| R-1…R-8 | all fixed | all fixed |

| ID | Finding | Judges | Status |
|---|---|---|---|
| F-1 | State → URL writes are router navigations; the shell's `collapsed` is a `linkedSignal` over the full URL (`client/src/app/shell/qa-shell.ts:93-99`, `:105`), so each Results filter change or keystroke re-expands a sidebar she collapsed. Fixing it in the shell would change Yeck's logic | FA-1 (severe) | **Suspect** (one judge); architect re-read `qa-shell.ts:93-105` and confirms the mechanism |
| F-2 | The `timeline` ⇔ `timelineId` rule is stated "for every entry", but single-result targets carry no `timeline` | FA-2, FB-1 | Agreed warning |
| F-3 | FR-5 statement (and the defect-class table) still say "the number in the sentence", not "the sentence's total" | FA-4, FB-2 | Agreed warning |
| F-4 | At risk writes "still pending" in lower case; FR-3 says the stage words are used exactly | FA-3, FB-3 | Agreed (warning / suggestion) |
| F-5 | NFR-4's Overview clause now covers Waiting, but the Overview's 212 is a typed "more than 14 days" figure | FA-5 | Suspect |
| F-6 | Where the URL write happens is unspecified (effect vs setters; late echo over typed search) | FA-6, FB (P-24 note: menus bind `[(value)]`, so setters alone miss them) | Suggestion |
| F-7 | Sidebar "Results" link while on filtered Results would now clear all filters | FB-4 | Suggestion |
| F-8 | Load's `delta` should equal `total` on a first load; "later loads" open question has no id | FB-5 | Suggestion |

Two fix rounds are used. Per the protocol the lineage is **not** extended: the decision goes to Juanpa.

**Architect's recommendation for F-1** (not applied): drop the state → URL write and keep Results' URL as today; instead (a) `ResultsView` re-seeds its filters on every `NavigationEnd` to `/results`, parsing that event's URL, and (b) notification targets navigate with `onSameUrlNavigation: 'reload'` for that one navigation, so a same-URL open still emits `NavigationEnd`. No URL write → the shell's `collapsed` signal sees no new URL, and `qa-shell.ts` stays untouched. F-2…F-8 are one-line text fixes.

JUDGMENT: ESCALATED ⚠️

## After escalation — Juanpa's decision

Juanpa: "Aplica el arreglo y sigue" (apply the architect's fix and continue without a third judgment round). Applied in `design.md` and `requirements.md`:

| Item | Fix |
|---|---|
| F-1 | Results writes no URL; it re-seeds on every `NavigationEnd` to `/results`, and notification navigations use `onSameUrlNavigation: 'reload'` (DD-11, P-27, P-28). `qa-shell.ts` untouched. Covered by `results-view.spec.ts` and a sidebar-state case in `notifications-bell.spec.ts` |
| F-2 | `timeline` ⇔ `timelineId` rule scoped to list targets |
| F-3 | FR-5 and the defect table compare "the sentence's total" |
| F-4 | At risk keeps the label's capitalization; the check is exact |
| F-5 | NFR-4's Overview clause limited to the waiting count (212), asserted in the mock spec |
| F-6 | Moot: no URL write |
| F-7 | Recorded as accepted behavior in the reversion challenge (e) |
| F-8 | Load `delta` = `total`; later loads → proposal OQ-7 |

The fix was not re-judged (lineage exhausted). It is checked by the tasks' tests and the Reviewer at `/akili-execute`.
