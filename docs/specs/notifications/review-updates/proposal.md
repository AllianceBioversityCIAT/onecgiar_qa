# Review updates for the QA Admin (notifications) — Proposal

## 1. Document Control

| | |
|---|---|
| Spec path | `docs/specs/notifications/review-updates` |
| Slug | `review-updates` — derived from the free-text argument "Necesito que crees un nuevo módulo. Que sea de notificaciones, sobre todo para María Julia…" |
| Type | Change |
| Deliverable | software |
| Approval Mode | gated |
| Author | Juanpa (design), 2026-10-22 |
| Jira | none yet |
| Domain | `notifications` — **new**; not yet in the `AGENTS.md` spec taxonomy (owner: Juanda) |
| Depends on | Real data needs specs that do not exist yet: `evaluation`, `comments`, `escalation`, `ingestion`. The mock phase depends on nothing |
| Parallel-safe | yes for the mock phase (new files + one added button in the top bar); no for the API phase (reads the comment and escalation state machines) |
| PRD | § 3 Personas (ADMIN), § 5 Out of scope ("Notifications…"), US-4, US-8–US-10 |
| TRD | § 7 Backend Workflows (comment state machine, Quality Assessed rule), § 9 Integration Points |
| Branch | `jp-design/mockup-completo` (the bell lives in the shell, which only exists on this branch until it is merged) |

## 2. Intent

Give the QA Admin (María Julia) one place where the review of results comes to her: what moved forward, what got stuck, and what needs her decision — so she stops checking Overview, Results and each result by hand to find out what changed.

## 3. Problem / Current Behavior

| # | Today | Evidence |
|---|---|---|
| 1 | The app has no notifications: the top bar holds back/forward, search, the Unsent button and the user menu, and nothing else | `client/src/app/shell/qa-shell.html:122-127`; `grep -rn -i "notif" client/src/app` → only the copy "Nobody is notified…" at `pages/workspace/cycle/timeline-drawer.ts:194` |
| 2 | The server has no notification module or table | `grep -rn -i "notif" server/src` → only a test fixture string at `common/idempotency/fingerprint.spec.ts:80` |
| 3 | The PRD keeps notifications out of v1 | `docs/prd.md:72` ("Notifications and follow-up between PPU and result owner inside the platform") |
| 4 | The only notification in the TRD goes from QA to Reporting ("QA passed"), not to people | `docs/trd/trd.md:233`, `:253` |
| 5 | The closest signal today is the Overview's "Needs attention" card, which shows the current state, not what changed | `client/src/app/pages/workspace/overview/overview.mock.ts` (`ATTENTION`) |
| 6 | An email-on-role-change idea was already logged as 🔴 (needs an email service and a business decision) | `docs/ideas.md:35` |

## 4. Proposed Outcome

- A **bell** in the top bar shows a dot when there is something unread and opens a panel with the latest updates.
- The panel links to a **Notifications page**: the full history grouped by day, with a "Viewing All timelines ⌄" context line, search, a Type filter and All / Unread.
- Each notification says what happened in one sentence (the subject in bold), its type, its timeline and its time, plus one action that opens exactly what it refers to ("View result", "View results").
- **Progress is grouped, exceptions are individual.** "71 results have now been assessed by 2 assessors in Round 1" is one notification, not 71. Single results only appear for escalations, TPB decisions and PPU "Done".
- Counts match the rest of the app: "View results" opens Results with the same filter and the same number as the sentence (and as the Overview, when the notification is about all timelines).
- Red is used once per block, for the one item at risk.

## 5. Scope

**In (mock phase, front only, on mock data):**
- Bell + dot in `qa-shell` top bar (added; nothing removed).
- Notifications panel (popover) and Notifications page (new lazy route `notifications`).
- Mock data in its own `notifications.mock.ts`, built from the same mock numbers as Overview and Results.
- Read / unread, "Mark all as read", empty state.
- 390 / 768 / 1024 / 1440 px, light and dark, WCAG AA.

**Event types (from Juanpa's answer "everything about the review"):**

| Type | Example | Grouped? |
|---|---|---|
| Stage | 71 results have now been assessed by 2 assessors in Round 1 | Yes, per stage and timeline |
| Program response | SP09 has answered 12 returned results | Yes, per program |
| Escalation | QA-2026-0841 was escalated to the third-party broker | No |
| Third-party broker | QA-2026-0377 moves to PPU | No |
| PPU | QA-2026-0412 was marked Done by PPU | No |
| Quality assessed | 40 results became Quality assessed | Yes, per day |
| Waiting | 212 returned results have waited on a program for more than 14 days | Yes |
| At risk | Step 5 closes in 2 days with 334 results still pending in Round 2 | Yes |
| Load | July 2026 sub-timeline loaded 216 results into QA | Yes, per load |

## 6. Non-Goals

- Email, push or Teams messages (Juanpa: "No por ahora"). Logged for later.
- Notifications for roles other than ADMIN (assessors, programs, TPB, PPU).
- A settings screen to choose which updates arrive.
- Real data, the server module and storage: they come after the mock is validated and the source specs exist.
- Changing the QA flow (rounds, stages, escalation).

## 7. Affected Users, Systems, And Specs

| Affected | How |
|---|---|
| ADMIN (María Julia) | Primary user |
| `client/src/app/shell/qa-shell.html` | One button added to the top bar (file has commits by Yeck; design-only addition) |
| `client/src/app/app.routes.ts` | One lazy route added (`notifications`) |
| New `client/src/app/pages/workspace/notifications/` | Page, panel, mock |
| `docs/ux-ui/design.md` | Screen inventory, navigation model, open questions |
| `docs/prd.md` § 5 | Out-of-scope line needs a business decision before the API phase |
| Future specs | `comments`, `escalation`, `ingestion`, `evaluation` emit the events |

## 8. Visual Reference

- Source: Generated mockup (claude-design)
- Location: Claude Design project "QA Platform", file `notifications/Notifications.dc.html` — https://claude.ai/design/p/90941fc5-0cfa-49fb-acdd-2db0ffcd3016?file=notifications%2FNotifications.dc.html · screenshot `docs/specs/notifications/review-updates/mockup/notifications-round-1.png`
- Notes: round 1 has five frames — **1a** bell panel, newest first · **1b** bell panel, "Needs you" first, then "Updates" · **1e** bell panel, nothing unread · **1c** Notifications page at 1280 px · **1d** Notifications page at 390 px. Built with the app's tokens, shell and copy rules (`docs/ux-ui/design.md` § 5–8). Dark mode not drawn yet.

## 9. Requirement Delta Preview

### ADDED Requirements

- The ADMIN sees a bell in the top bar; a dot appears when at least one notification is unread, and the button's accessible name says how many ("Notifications, 4 unread").
- The bell opens a panel with the most recent notifications and a link to the full page.
- The Notifications page lists all notifications grouped by day, filterable by timeline, type, read state and text.
- Each notification opens its target with the same filter and count as Overview and Results.
- Progress events are grouped per stage, program, day or load; escalations, TPB decisions and PPU "Done" are per result.
- Opening a notification marks it as read; "Mark all as read" clears the dot.

### MODIFIED Requirements

- Top bar: gains the bell, before the Unsent button.
- PRD § 5: in-app notifications for the ADMIN move from out of scope to in scope (pending business decision).

### REMOVED Requirements

- None.

## 10. Approach Options

| Option | What | Trade-off |
|---|---|---|
| **A. Mock first (front only)** | Build bell, panel and page on `notifications.mock.ts`; validate with María Julia | 🟡 Juanpa can build it now, in days, without touching the backend; the events are illustrative until the source specs exist |
| B. Event store on the server | A `notifications` module writes one row per event when comments, escalations, stages or loads change state; the front polls an endpoint; read state per user | The right end state, but it depends on four specs that do not exist yet; weeks, backend (Juanda) |
| C. Feed computed on read | No new table: the server derives "what changed since your last visit" from result and comment history | Less storage, but "since last visit" and grouping get complex and slow; depends on the `history` spec |

## 11. Recommended Approach

**Option A now, then B as its own spec.** A is the smallest safe path: it adds new files and one button, touches no logic, and lets María Julia say which events matter before anyone builds storage for them. When `comments` and `escalation` are specified, B reuses the event types and copy validated here. C is rejected because it ties notifications to the `history` spec and makes counts harder to keep equal to Overview and Results.

## 12. Risks, Dependencies, And Open Questions

| # | Item | Owner |
|---|---|---|
| R1 | **Noise.** One notice per result would bury María Julia (1,330 results). Mitigated by grouping; the grouping rules need her validation | Juanpa + María Julia |
| R2 | **Scope conflict with the PRD** (§ 5 keeps notifications out of v1). The mock is safe; the API phase needs a business decision | Santi / Ángel |
| R3 | The events come from specs that do not exist yet; the mock may promise events the flow cannot produce as drawn | Juanda |
| R4 | The bell goes in `qa-shell.html`, which has commits by Yeck — design-only addition, no logic removed | Yeck (review) |
| OQ-1 | Which events are "Needs you" and which are "Updates" (frames **1a** vs **1b**)? | María Julia |
| OQ-2 | Does she want each escalation individually, or a daily count? | María Julia |
| OQ-3 | How long are notifications kept (30 days, the whole cycle)? | Business |
| OQ-4 | Should other roles (lead assessors, programs, PPU) get their own later? | Business |
| OQ-5 | Email: daily digest later? Needs an email service (see `docs/ideas.md:35`) | Business + infrastructure |
| OQ-6 | Is "Notifications" also a sidebar item, or only reached from the bell? (mockup: bell only) | Juanpa |
| OQ-7 | Later loads of a timeline (e.g. a second batch of 38 results): how is the run's size shown, given Results lists the whole timeline? Mock phase covers first loads only | Business + Juanda (API phase) |

## 13. Success Criteria

- María Julia reviews the mockup and picks the panel layout (**1a** or **1b**) and the event list.
- From the bell, every notification reaches its result or filtered list in at most 2 clicks.
- Every "View results" count equals the Results count for the same filter (and the Overview's, for notifications about all timelines).
- No horizontal scroll at 390, 768, 1024 and 1440 px; WCAG AA in light and dark; full keyboard path (bell → panel → item → target).
- `npx ng build` passes with the mock phase in place.

## 14. Next Step

```text
/akili-specify notifications/review-updates
```

Standard depth, front-only mock phase. The API phase (Option B) becomes its own proposal once `comments` and `escalation` exist and the PRD scope is decided.
