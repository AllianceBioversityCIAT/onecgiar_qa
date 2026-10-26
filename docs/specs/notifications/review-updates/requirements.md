# Review updates for the QA Admin (notifications) — Requirements

## 1. Document Control

| Spec path | Status | PRD stories | Last updated |
|---|---|---|---|
| docs/specs/notifications/review-updates | Draft | US-4, US-8, US-9, US-10 (events the ADMIN follows); PRD § 3 ADMIN | 2026-10-22 |

| | |
|---|---|
| Type | Change |
| Deliverable | software |
| Depth | Standard |
| Approval Mode | gated |
| Phase covered | **Mock phase only** (front end on mock data). Real data is a later spec (proposal § 10, option B) |
| Proposal | `proposal.md` (approved by Juanpa, 2026-10-22) |
| Visual reference | Claude Design "QA Platform" → `notifications/Notifications.dc.html`, frames 1a, 1c, 1d, 1e; screenshot `mockup/notifications-round-1.png` |
| Panel layout | **1a (newest first, grouped by day)** — assumed; frame 1b ("Needs you" first) stays an open question for María Julia (OQ-1) |

## 2. Executive Summary

The QA Admin gets a bell in the top bar and a Notifications page that tell her what changed in the review of results — stages reached, program answers, escalations, broker and PPU decisions, results that became Quality assessed, long waits, steps at risk and loads — and take her straight to the results behind each update. This phase runs on mock data so María Julia can validate which updates matter before the server stores them.

## 3. Glossary

| Term | Meaning |
|---|---|
| Notification | One update shown to the QA Admin: a sentence, a type, a timeline, a time and one action |
| Grouped notification | One notification that counts many results ("<n> results reached Assessed by 2 assessors in Round 1") |
| Single-result notification | One notification about one result code (escalation, broker decision, PPU Done) |
| Unread | A notification the QA Admin has not opened and has not marked as read |
| Bell | The top-bar button that opens the notifications panel |
| Panel | The pop-over that opens from the bell with the latest notifications |
| Notifications page | The full list at `/notifications` |
| QA stage | The result stages of `docs/ux-ui/design.md` § 7 (Round 1: Pending · In review · Assessed by 1 assessor · Assessed by 2 assessors — Round 2: Pending · Assessed — Final: Quality assessed) |
| Target | What the notification's action opens: a result or a filtered Results list |

## 4. System Context & Scope

**In scope (mock phase):** bell, panel, Notifications page, read / unread state, filters, empty / loading / error states, on mock data that agrees with the Overview and Results mocks.

**Out of scope:** email or any channel outside the app; notifications for roles other than ADMIN; a settings screen to choose which updates arrive; storing notifications on the server; deciding PRD § 5 (business).

**Current behavior:**

| # | Today | Evidence |
|---|---|---|
| C-1 | The top bar holds back / forward, search, the Unsent button and the user menu; there is no notification control | `client/src/app/shell/qa-shell.html:96-148` (header), `:122` (`<qa-unsent-center />`) |
| C-2 | No notification code exists in the client or the server | `grep -rn -i "notif" client/src/app server/src` → only the copy at `client/src/app/pages/workspace/cycle/timeline-drawer.ts:194` and a fixture string at `server/src/common/idempotency/fingerprint.spec.ts:80` |
| C-3 | Admin-only views are gated by the `ADMIN_ACCESS` permission at route match and activation; the shell hides admin menu items with the same permission | `client/src/app/app.routes.ts:12-27` (`view()` with `permissionMatch` / `permissionActivate`), `client/src/app/shell/qa-shell.ts:38-57`, `:89-90` |
| C-4 | Results reads its filters from the URL: `?timeline=`, `?stage=`, `?q=`, `?program=`, `?type=`, `?assessor=`, `?status=` (list values comma separated) | `client/src/app/pages/workspace/results/results-view.ts:79`, `:89`, `:93-97` |
| C-5 | QA stage ids are `r1-pending`, `r1-review`, `r1-one`, `r1-two`, `r2-pending`, `r2-assessed`, `quality-assessed` | `client/src/app/pages/workspace/results/results.mock.ts:400` |
| C-6 | The Overview shows, for the whole cycle: 148 · 200 · 71 · 180 (Round 1), 334 · 40 (Round 2), 357 Quality assessed; "212 returned results … more than 14 days"; July 2026 sub-timeline 216 results | `docs/overview-rounds-2026-10-16.md` (Tested), `docs/results-y-estados-2026-10-21.md` (Cuarta parte, Tested), `client/src/app/pages/workspace/overview/overview.mock.ts` (`ATTENTION`, `TIMELINES` `jul`) |
| C-7 | The PRD keeps "Notifications …" out of v1 | `docs/prd.md:72` |

## 5. Stakeholders / Personas

| Role (PRD § 3) | Scope | What they need from this spec |
|---|---|---|
| ADMIN (María Julia) | Global | Know what changed without checking every screen; reach the results behind each update in one or two clicks |
| ASSESSOR, LEAD_ASSESSOR, TPB, PPU, PROGRAM, GUEST | — | Nothing in this phase: they must not see the bell or the page |
| Juanpa (designer) | — | Validate the layout and the event list with María Julia |
| Yeck / Juanda | — | Mock data kept apart so it can be replaced by an API later |

## 6. Functional Requirements

### FR-1: Bell in the top bar

The system SHALL show a bell button in the top bar for users with `ADMIN_ACCESS`, before the Unsent button. When at least one notification is unread, the bell SHALL show a dot, and its accessible name SHALL say how many are unread.

#### Scenario: Admin with unread notifications
- GIVEN the QA Admin is signed in and 4 notifications are unread
- WHEN any workspace page loads
- THEN the top bar shows the bell with a dot
- AND the bell's accessible name is "Notifications, 4 unread"
- BUT it must NOT show the number as a colored badge or pill on the bell
- AND IT MUST keep the existing top-bar controls (back, forward, search, Unsent, user menu) in place and working

#### Scenario: Nothing unread
- GIVEN every notification is read
- WHEN the page loads
- THEN the bell shows no dot and its accessible name is "Notifications"

#### Scenario: User without ADMIN_ACCESS
- GIVEN a signed-in user without `ADMIN_ACCESS` (e.g. an assessor)
- WHEN any workspace page loads
- THEN the top bar shows no bell
- BUT it must NOT leave an empty gap where the bell would be

### FR-2: Notifications panel

The bell SHALL open a panel with the most recent notifications (at most 8), grouped by day (Today, Yesterday, Earlier), newest first, with an All / Unread switch, "Mark all as read" and "View all notifications".

#### Scenario: Open and close
- GIVEN the QA Admin is on any workspace page
- WHEN she activates the bell (click, Enter or Space)
- THEN the panel opens under the bell and focus moves into it
- AND pressing Escape, clicking outside or activating the bell again closes it and returns focus to the bell
- BUT it must NOT navigate away or lose the page's state (filters, scroll) when it opens or closes

#### Scenario: Unread only
- GIVEN the panel is open with 4 unread and 5 read notifications
- WHEN she selects "Unread"
- THEN only the 4 unread notifications are listed
- AND the switch reads "Unread 4" with the count as a plain grey number

#### Scenario: View all
- GIVEN the panel is open
- WHEN she activates "View all notifications"
- THEN the panel closes and the Notifications page opens

#### Scenario: Panel on a phone
- GIVEN a viewport narrower than 640 px
- WHEN she activates the bell
- THEN she reaches the full list (panel or page) with no horizontal scroll and every action at least 40 px tall

### FR-3: Content of a notification

Every notification SHALL show one sentence that starts with its subject in bold, its type, its time and one action; the Notifications page also shows its timeline. Unread notifications SHALL carry a small dot.

The type SHALL be one of this closed set: **Stage · Program response · Escalation · Third-party broker · PPU · Quality assessed · Waiting · At risk · Load**.

#### Scenario: Reading a notification
- GIVEN the notification "QA-2026-0841 was escalated to the third-party broker…"
- WHEN it is listed
- THEN "QA-2026-0841" is bold, the rest of the sentence is regular
- AND below it reads "Escalation · Annual report 2026 · 10:42" (timeline on the page only)
- BUT it must NOT put icons before the type or the sentence
- AND IT MUST use the QA stage words of `docs/ux-ui/design.md` § 7 exactly ("Assessed by 2 assessors", "Quality assessed", never "Approved" or "Done" for a stage)

#### Scenario: At risk
- GIVEN a notification of type At risk
- WHEN it is listed
- THEN its type label is red (`--danger`) and semibold
- BUT it must NOT color any other type, sentence or count red

### FR-4: Grouping

Progress SHALL be shown as grouped notifications; only Escalation, Third-party broker and PPU notifications SHALL name a single result.

| Type | One notification per |
|---|---|
| Stage | assessed stage reached, per timeline, per day |
| Program response | program, per day |
| Quality assessed | timeline, per day |
| Waiting, At risk | condition, when it starts |
| Load | first load of a timeline (later loads: proposal OQ-7) |
| Escalation, Third-party broker, PPU | result |

#### Scenario: Many results reach a stage
- GIVEN 18 results reached "Assessed by 2 assessors" in Round 1 today
- WHEN the list is shown
- THEN there is one Stage notification for them, stating the timeline's total in that stage and today's change (18)
- BUT it must NOT list 18 separate notifications

### FR-5: Action targets

Each notification's action SHALL open exactly what it refers to, and the count the target shows SHALL equal the sentence's total — never its change since yesterday or other qualifiers such as days left (NFR-4).

| Action | Opens |
|---|---|
| View result | That result's review page (`/results/:code`) |
| View results | Results filtered to the notification's stage, timeline, program or condition (At risk included) |

The mockup's "Show progress" → Cycle is not used: Cycle's numbers come from its own mock and could not match the sentence (`design.md` DD-13, amended after Judgment Day round 1).

#### Scenario: Stage notification to Results
- GIVEN the Stage notification "<n> results reached Assessed by 2 assessors in Round 1", timeline Annual report 2026
- WHEN she activates "View results"
- THEN Results opens on Annual report 2026, filtered to Round 1 · Assessed by 2 assessors
- AND it shows <n> results — the same number Results shows when those filters are set by hand
- BUT it must NOT compare against the Overview's whole-cycle figure when the notification is about one timeline
- AND IT MUST be a deep link: opening the same URL in a new tab shows the same filter and count

#### Scenario: Activating the row
- GIVEN a notification in the panel
- WHEN she activates the row itself
- THEN the same target as its action opens and the panel closes

### FR-6: Notifications page

The system SHALL provide a Notifications page at `/notifications`, for `ADMIN_ACCESS` only, with the standard page header, a "Viewing All timelines ⌄" context line, a filter row (search · Type · All / Unread), the list grouped by day, and "Mark all as read".

#### Scenario: Filter by timeline and type
- GIVEN the page lists 9 notifications
- WHEN she chooses "July 2026 sub-timeline" in the context line and "Load" in Type
- THEN only notifications of that timeline and type are listed
- AND the applied filters are visible and can each be removed

#### Scenario: Search
- GIVEN the page is open
- WHEN she types "SP09"
- THEN only notifications whose sentence, subject or timeline contains "SP09" are listed (case-insensitive)

#### Scenario: No access
- GIVEN a user without `ADMIN_ACCESS`
- WHEN they open `/notifications`
- THEN they get the same result as opening another admin view without access (the existing forbidden handling)
- BUT it must NOT download the page's code first

### FR-7: Read state

Opening a notification (row or action) SHALL mark it read. "Mark all as read" SHALL mark every notification read. The bell, the panel and the page SHALL always agree on what is unread.

#### Scenario: Open one
- GIVEN 4 unread notifications
- WHEN she opens one from the panel
- THEN 3 remain unread in the bell's name, the panel and the page

#### Scenario: Mark all as read
- GIVEN 4 unread notifications
- WHEN she activates "Mark all as read"
- THEN the bell loses its dot and the Unread view shows the empty state
- AND IT MUST be a no-op, without errors, when nothing is unread ("Mark all as read" hidden or inactive)

#### Scenario: Reload in the mock phase
- GIVEN she read some notifications
- WHEN she reloads the app
- THEN the read state MAY reset to the mock's initial state (no storage in this phase)

### FR-8: Empty, loading and error states

The panel and the page SHALL each have an empty state, a no-match state, a loading state and an error state.

#### Scenario: Nothing unread
- GIVEN the Unread view has nothing
- THEN it reads "No unread notifications" with "Show all"

#### Scenario: Filters match nothing
- GIVEN the page's filters match no notification
- THEN it reads "No notifications match these filters" with "Clear filters"

#### Scenario: Loading and error
- GIVEN the source is still loading, or failed
- THEN loading shows placeholder rows of the same height as real rows
- AND the error reads "Couldn't load notifications." with "Try again"
- AND IT MUST be possible to show both states with the mock (a mock switch), since the mock never fails on its own

### FR-9: Responsive layout and accessibility

The bell, panel and page SHALL work at 390, 768, 1024 and 1440 px, in light and dark mode, with a full keyboard path.

#### Scenario: Keyboard path
- GIVEN focus is in the top bar
- WHEN she tabs to the bell, opens it, moves through the notifications and activates one
- THEN each step has a visible focus ring and the target opens
- BUT it must NOT trap focus after the panel closes

#### Scenario: Widths and themes
- GIVEN each of 390, 768, 1024 and 1440 px, in light and dark mode
- WHEN the panel and the page are shown
- THEN there is no horizontal page scroll, text does not overlap, and text contrast is at least 4.5:1

## 7. Non-Functional Requirements

| ID | Attribute | Scenario (source → stimulus → response) | Measure | TRD ref |
|---|---|---|---|---|
| NFR-1 | Accessibility | ADMIN → uses bell, panel and page with keyboard or screen reader → every control is named and reachable | WCAG 2.2 AA; zero AXE violations on the page and the open panel | `client/CLAUDE.md` § Accessibility |
| NFR-2 | Performance (bundle) | Build → shell gains the bell → initial bundle grows little | Initial bundle grows ≤ 5 kB; the page is lazy loaded | `client/angular.json` budget (current warning predates this spec) |
| NFR-3 | Replaceability | A developer → replaces the mock with an API → page and panel do not change | All notification data comes from one source; no mock data inside components | `docs/ux-ui/design.md` § 8, team rule "mock data apart" (`CLAUDE.md` § 3.8) |
| NFR-4 | Consistency | Notifications and Results → show the same figure for the same filter (and the Overview too, where it shows a figure for the same filter: the waiting count, 212) | 100 % of the mock's notifications with a list target: the sentence's total (never its change since yesterday or other qualifiers) equals the count Results shows on the target | — |

### Defect classes and their gates

| Defect class this spec can produce | Gate (command or check) | Substitute / accepted risk |
|---|---|---|
| Type / compile error | `cd client && npx ng build` | — |
| Wrong unread count or read state out of sync (FR-1, FR-7) | Unit tests on the notifications source: `cd client && npx ng test --watch=false` | — |
| Wrong grouping, filter or search result (FR-4, FR-6) | Unit tests on the source's derived lists | — |
| Number in a notification ≠ count on its target (FR-5, NFR-4) | Unit test that renders each target in Results and compares its count with the sentence's total | Browser check at the HITL pause for the deep links |
| Bell visible to a non-admin (FR-1) | Unit test of the shell with a non-admin access mock | — |
| Page reachable without access (FR-6) | Existing permission guard (route data); unit test of the route entry | — |
| Layout: overflow, clipping, panel off-screen (FR-2, FR-9) | Rendered measurement in a real browser (Playwright) at 390 / 768 / 1024 / 1440: page `scrollWidth ≤ clientWidth`, panel bounding rect inside the viewport | T6 visual review against the mockup at the HITL pause |
| Contrast and dark mode (FR-9) | No automated check measures contrast here | Human check in light and dark at the HITL pause (Juanpa), using token values |
| Keyboard and focus (FR-2, FR-9) | Browser walk with the keyboard (Playwright) | Human check at the HITL pause |
| AXE violations (NFR-1) | No AXE tool is installed in `client/` (`client/package.json` has no `axe` entry); adding one is a dependency change that needs a developer | Playwright accessibility tree review + contrast from computed colors in T-7; **accepted gap** until a developer adds AXE |
| Wrong vocabulary (FR-3) | Unit test that the stage words come from the shared stage labels | Review against `docs/ux-ui/design.md` § 7 |
| Events that the real flow cannot produce as drawn | No check in this phase | **Accepted risk** (proposal R3): settled when the `comments` / `escalation` specs exist |

## 8. Requirement ID Index

| ID | Title | Scenarios | Owning task(s) |
|---|---|---|---|
| FR-1 | Bell in the top bar | Admin with unread · Nothing unread · User without ADMIN_ACCESS | T-5, T-7 |
| FR-2 | Notifications panel | Open and close · Unread only · View all · Panel on a phone | T-1, T-5, T-6, T-7 |
| FR-3 | Content of a notification | Reading a notification · At risk | T-3, T-4 |
| FR-4 | Grouping | Many results reach a stage | T-3 |
| FR-5 | Action targets | Stage notification to Results · Activating the row | T-2, T-3, T-5 |
| FR-6 | Notifications page | Filter by timeline and type · Search · No access | T-6, T-7 |
| FR-7 | Read state | Open one · Mark all as read · Reload in the mock phase | T-3, T-5, T-6 |
| FR-8 | Empty, loading and error states | Nothing unread · Filters match nothing · Loading and error | T-3, T-4, T-6 |
| FR-9 | Responsive layout and accessibility | Keyboard path · Widths and themes | T-4, T-5, T-7 |
| NFR-1 … NFR-4 | Accessibility, bundle, replaceability, consistency | — | T-3, T-6, T-7 |
