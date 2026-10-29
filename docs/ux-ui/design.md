# OneCGIAR QA — UX/UI Design

| | |
|---|---|
| Status | Draft v0.2 |
| Last updated | 2026-10-22 (mockup changes from 2026-10-13 to 2026-10-21; details in the `docs/*-2026-10-*.md` work notes) |
| Source of truth for visuals | The designer's mockup, implemented on branch `jp-design/mockup-completo` (`client/src/app/ui/tokens/qa-tokens.css`, `client/src/app/ui/**`, `client/src/app/shell/**`) |
| Technical rules | `client/CLAUDE.md` (Angular), `docs/trd/trd.md` § Frontend Architecture |

> **In one line:** a calm, dense, desktop-first workspace in teal on neutral greys — one shell with a left navigation, tables to find results, and a field-by-field review page where every comment, response and decision is visible in place.

Tokens and components below are taken from the mockup branch, which has not reached `staging` yet. When it merges, the paths in this document become live; until then they are the target.

---

## 1. Product Experience Principles

| Principle | Means in practice |
|---|---|
| **The field is the unit of work** | Review happens per field, with its value, AI suggestion, comments and state side by side. |
| **State is always visible** | Every result, field and comment shows its state with a status chip (§ 7 status tokens); no hidden transitions. |
| **Role-shaped, not role-split** | One app; what you can do on a screen depends on your scoped roles. Read-only users see the same screens without actions. |
| **AI suggests, people decide** | AI suggestions are visually distinct, labeled, and only enter a comment when a person copies them. |
| **Coordination without the tech team** | Every cycle/batch/field setting has a screen; nothing requires a script. |
| **History on demand** | Any result can show how it entered and left QA and what changed between snapshots. |

## 2. Information Architecture

```
Login
Workspace (shell: left nav + top bar)
├── Overview          — where the active cycle stands: Round 1 / Round 2, timelines, needs attention, where the work is
├── Results           — results under assessment, filtered by timeline and QA stage → Result review (/results/:code)
│   └── Result review — field-by-field evaluation, comments, history tab
├── Cycle             — the active cycle only: official timeline + sub-timelines (admin)
├── Fields            — field configuration per result type, published in one step (admin)
└── Assessors         — users, roles and scopes (admin)
```

Routes on the mockup branch: `login`, `''` (overview), `results`, `results/:code`, `cycle`, `fields`, `assessors`.

Results deep links: `?stage=<stage>[,<stage>…]` (QA stage, several allowed), `?timeline=<id>`, and `?status=` (only for the "waiting on a program" link in Needs attention). Every Overview figure opens Results through one of these.

## 3. Primary User Flows

| Flow | Steps | Screens |
|---|---|---|
| Configure the active cycle | Edit the official timeline and its steps → add sub-timelines for late programs or result types → configure fields per result type → Review & publish | Cycle, Fields |
| Load results | A step that loads opens → results enter QA for that timeline's scope | Cycle (load drawer), Results |
| Follow the cycle | Overview → pick a round stage or a timeline → Results opens already filtered | Overview → Results |
| Assess a result | Open result → per field: approve or comment (AI suggestion available) → submit | Results → Result review |
| Respond as program | Open result → per comment: accept / accept with comment / disagree / clarify | Result review (**no mockup yet**, OQ-5) |
| Escalate & decide | Lead escalates core-field disagreement → TPB decides → PPU marks Done | Result review (comment thread actions) |
| Audit a result | Open result → History tab → compare snapshots | Result review |

## 4. Screen Inventory

| Screen | Status | Primary roles | Notes |
|---|---|---|---|
| Login | Mockup + stub auth (`feat/auth-login`) | All | SSO and custom login (Cognito via auth microservice) |
| Overview | Mockup | All | Filter bar for the whole page: Viewing <timeline> ⌄ · Science program · Result type. In this order (María Julia, 2026-10-27): Timeline progress (one lane per timeline the filters keep, "1 of 5" when some are hidden, "View stages" pop-up); Round 1 and Round 2 cards + Quality assessed strip; Assessment pace (the step most behind, "Assessor ⌄" in the assessors' step; four figures in a row, chart across the card below); Progress by result type; Assessor load. Every count opens Results with the same filters. No notifications block |
| Results | Mockup | All | "Viewing <timeline> ⌄" context line; filter row: search · QA stage (multi-select grouped by round) · Science program · Result type · Assessor; applied-filter chips; table with QA stage (round above the label). Automatic results are not listed (not under assessment) |
| Result review | Mockup (`review/`) | Assessor, Lead, TPB, PPU, Program | Field list + detail panel with "AI match"; header shows round and stage ("Round 2 · Pending") |
| Cycle | Mockup | Admin | Title "Assessment cycle". Official timeline card (named after the timeline) + Sub-timelines (Live / Closed tabs, current cycle only); timeline and step drawers with closed, scope-locked and in-progress states; empty states; load drawer |
| Fields | Mockup | Admin | "Configuring <result type> ⌄" context line + chips (All fields · Hidden · View only · Assessed · Third-party \| Core only); sticky Review & publish bar |
| Assessors | Mockup | Admin | Drawer to edit roles and result types |
| Notifications | Provisional, mock data (`jp-design/mockup-completo`) | Admin | Bell in the top bar that opens the page (no panel, since 2026-10-27); page `/notifications`: one list, with no tabs, no filters and no "Mark all as read". It holds only what María Julia asked for: a step finished for a batch, and slow science programs. Each row says its timeline and carries its button (Juanpa, 2026-10-29: the PRMS tabs had been copied, not adapted). Rows grouped Today · Yesterday · Earlier, each with an unread dot, a tinted icon, one sentence and a meta line (type · batch · step · time). Needs-action rows (step complete, slow program, at risk) carry a main button and "Not now"; the others open Results with the matching filter. Not a priority (meeting, 2026-10-27); to adjust after talking with María Julia. Spec `docs/specs/notifications/review-updates/` |
| Program response | **Missing** | Program | OQ-5 |
| History / snapshot diff | **Missing** | All | Needs design in the `history` spec |
| UI gallery | Dev-only | — | `ui/ui-gallery.ts` |

## 5. Navigation Model

- Persistent left navigation (`shell/qa-shell`) with the workspace sections in two groups, ASSESSMENT and ADMINISTRATION (uppercase eyebrow labels); admin-only sections hidden for users without ADMIN.
- Active nav item: tint background, weight 600 and a 2×16 px rounded `--primary` marker centered on its left edge (Jira-style; no full-height stripe).
- Active cycle block at the top of the navigation: an outlined panel (`--nav-divider` border, no fill, no shadow) showing "Annual report 2026" · Active (6 px green dot, grey word) and "Step 5 of 5 · closes 19 Jul". It links to Cycle; hover changes only the border. Hidden when the navigation is collapsed.
- Top bar: back/forward, search by code or title, Notifications (admins only; as in PRMS: bell, "Notifications" and the unread count in a primary pill), Unsent button (only while something is waiting to be sent), user menu (roles, sign out). There is no cycle selector: the app always works on the active cycle.
- The bell is a link to `/notifications` at every width: no panel (Juanpa, 2026-10-27). Below 768 px only the bell shows (40 px on phones, 36 px from 640 px), with the pill on its corner; from 768 px it reads "🔔 Notifications [4]" (Juanpa, 2026-10-28; "99+" past 99). It shows as pressed while on that page. Notifications is not a sidebar item.
- Deep links work for every result (`/results/:code`) and for Results filters (§ 2); the review page keeps filters on return.
- Drawers for edit-in-place (load batch, edit assessor); dialogs only for confirmations.

## 6. Layout Patterns

| Pattern | Use |
|---|---|
| Shell + content | Every workspace page |
| Filter bar + data table | Results, Assessors |
| Filter bar | Same in Results and the Overview: "Viewing <timeline> ⌄" context line, the filter menus under it, then the applied-filter chips with "Clear all". It is not sticky and has no divider; it scrolls away with the page. A block may keep only a choice of its own that the bar cannot make (the Overview's Assessment pace keeps "Assessor ⌄"). Never a second timeline picker inside a block. If a sticky bar is ever needed, it is decided for every screen at once (Juanpa, 2026-10-28) |
| List + detail split | Result review (fields on the left, field detail and thread on the right) |
| Cards grid | Overview; every section keeps its title and subtitle inside its card |
| Right drawer | Create/edit forms that keep context (batch load, assessor roles, timeline and step editing) |
| Timeline / stepper | Cycle timelines and steps; Overview timeline lanes (5-step tracker, current step, open step's progress) |
| Page header | Every screen: fs-26 title + short subtitle. Overview uses the same header (no lead sentence) |
| Context line selector | A selector set inside a sentence, no box (`qa-select appearance="inline"`): "Viewing All timelines ⌄" (Results), "Configuring Innovation development ⌄" (Fields). Used when the choice defines what the whole page shows |
| Sticky action bar | Bottom bar (`sticky bottom-0`, top border), same style as the Result review footer. In Fields it appears only with unpublished changes ("N unpublished changes in …" + "Review & publish (N)"), and after publishing or discarding it confirms for 4 s and hides. Full-width button on phones |
| Pop-up detail | `qa-dialog` for a read-only detail that would crowd the page, e.g. a timeline's stages from the Overview |
| Empty state | A card with what is missing, why, and the next action when the user can take it ("No live timelines" + New sub-timeline) |

## 7. Design Tokens

Defined as CSS custom properties on `.qa-tokens` (light) and `.dark .qa-tokens` (dark) in `client/src/app/ui/tokens/qa-tokens.css`. **Use the token, never a raw hex**, and map Tailwind utilities to these variables.

| Group | Tokens (light value) |
|---|---|
| Brand | `--primary #0F766E`, `--primary-hover #115E59`, `--accent #115E59`, `--accent-strong #0C4A45` |
| Tints | `--tint #F0FBFA`, `--tint-2 #D7F2EF`, `--tint-3 #ADE3DD`, `--tint-4 #C8EBE7` |
| Surfaces | `--bg #F7F7F9`, `--surface #FFFFFF`, `--surface-2…6`, `--surface-raised` |
| Text | `--text #191524`, `--text-2…5`, `--text-muted #9691A8` |
| Borders | `--border #E3E3E8`, `--border-soft`, `--border-strong`, `--border-accent` |
| Navigation | `--nav-bg`, `--nav-2`, `--nav-3`, `--nav-text`, `--nav-fg…3`, `--nav-divider`, `--nav-eyebrow` |
| Status (fg / bg pairs) | `--st-editing-*` (amber), `--st-submitted-*` (blue), `--st-qa-*` (cyan), `--st-approved-*` (green), `--st-rejected-*` (red), `--st-pending-*` (slate), `--st-indigo-*` |
| Feedback | `--danger`, `--danger-bg`, `--danger-strong`, `--warning`, `--success` |
| AI | `--ai #6B46E5`, `--ai-hover`, `--ai-tint`, `--ai-tint-2`, `--ai-tint-3` — only for what comes from an AI suggestion (e.g. the `ai` button tone, "Use as comment") |
| Charts | `--chart-1…4` (teal ramp) |
| Elevation | `--shadow-pop`, `--shadow-seg`, `--overlay` |
| Type scale | `--fs-10 … --fs-30`, scaled by `--fs` (user font-size preference) |
| Font | `Manrope, system-ui, sans-serif` |

Login screens use the separate palette set in `client/src/app/theme/palettes.ts` (tonal palettes, accents ≥ 4.5:1 on white).

**Color carries meaning, not decoration.** Red (`--danger`) appears only where something will go wrong without action: the Coverage group in Needs attention and "At risk" pace. "Behind" is dark grey, "On track" light grey; counts are plain muted numbers, not colored pills. Round bars go from grey (not started) to the round's full color — indigo for Round 1, blue for Round 2 — and green is kept for the final Quality assessed state.

### Status vocabulary

One word per state, the same on every screen. Results, Review and the Overview share the QA stage list.

| Level | Where | States |
|---|---|---|
| Timeline | Cycle, Overview, Results | Live · Scheduled · Closed |
| Timeline step | Cycle; Overview stages pop-up | Completed · In progress · Behind · Not started (Cycle also shows "Opens in N days") |
| Result QA stage | Overview, Results, Review | Round 1: Pending · In review · Assessed by 1 assessor · Assessed by 2 assessors — Round 2: Pending · Assessed — Final: Quality assessed. "Automatic" exists in data but is not under assessment |
| Field | Result review | Not reviewed · Commented · Answered · Approved · Highlighted |
| Pace | Where the work is | On track · Behind · At risk |
| Assessor | Assessors | Active · Never signed in … |

"Quality assessed" is used only for the final state; round cards say "Assessed". "Closed" is used only for timelines; a finished step is "Completed".

## 8. Component Inventory

Reuse before creating; style with Tailwind on top of these.

| Layer | Components |
|---|---|
| spartan/ui (`client/src/app/spartan/`) | alert, button, card, field, separator, spinner |
| QA kit (`client/src/app/ui/`) | badge, button, date-picker, dialog, drawer, menu, multi-select, progress, segmented, select, switch, tabs, tooltip, unsent center |
| Shell | `shell/qa-shell` |

**Buttons** (`ui/button/qa-button.ts`): always `hlmBtn qaBtn` together (spartan keeps accessibility and the disabled state), imported with `QaButtonImports`. The `class` attribute carries layout only; color, size, radius, weight, hover and focus come from the tone.

| Tone | Use it for | Examples |
|---|---|---|
| `primary` | The main action of a page, drawer or dialog — one per area | Invite, Load results, Finish |
| `secondary` | Supporting or exit actions; supports a pressed state (`aria-pressed`) for toggles | Cancel, Edit timeline, Show all fields |
| `danger` | Confirms something that deletes or closes | Remove, Close timeline |
| `danger-quiet` | Opens a destructive path without confirming it | Discard all |
| `link` | Goes somewhere or shows more; `flush="start"\|"end"` aligns the label with nearby text | Go to Assessors, View stages |
| `ai` | Acts on an AI suggestion | Use as comment |

Sizes: `md` 36 px (page headers, drawer and dialog footers), `sm` 32 px (cards, tables, toolbars); at least 40 px tall on phones. Not covered: icon-only buttons, filter chips, tabs and menu items.

**Selects:** `qa-select` appearances `default`, `filter` and `inline` (context line); optional search, groups and a count per option. `qa-multi-select` supports option groups with the same 11 px uppercase headers. Only lists that can grow long keep a search box (Assessor, the timeline selector); short lists show in full.
| Domain (to build) | Field review row, comment thread, AI suggestion card, snapshot diff, status chip per state machine |

## 9. Responsive Behavior

- **Desktop-first** (assessment is dense work), fully usable from 1280 px; layouts adapt down to tablet (768 px).
- Mobile (≥ 360 px): read and respond to comments; tables become stacked cards; admin configuration is not optimized for phones.
- Left navigation collapses to icons below 1024 px and to a drawer below 768 px.

## 10. Accessibility Expectations

- WCAG 2.2 AA and zero AXE violations (also required by `client/CLAUDE.md`).
- Status is never conveyed by color alone — chips carry a text label.
- Visible focus ring using `--primary`; full keyboard path through the review page (next/previous field shortcuts).
- Font scale via `--fs` respects the user's preference.
- Form errors: a field turns red only after the user leaves it, and always together with its message. Error styling uses the QA attribute `data-error` (`data-[error=true]:border-(--danger)`), not spartan's `data-invalid`, which is set before the user touches the field.
- Filled buttons pass AA in dark mode (e.g. Approve and Finish 7.8:1, Use as comment 4.6:1, checked 2026-10-13).

## 11. Dark Mode Behavior

- Every token has a dark value under `.dark .qa-tokens`; components must not hard-code light colors.
- Toggle in the user menu; default follows the OS preference.
- Status chips keep ≥ 4.5:1 contrast in both modes.

## 12. Design Decisions

| ID | Decision | Why |
|---|---|---|
| UXD-1 | Teal primary on neutral greys, Manrope | Mockup direction; calm, readable for long sessions |
| UXD-2 | spartan/ui + own QA kit, Tailwind 4 utilities | Accessible primitives with full styling control in Angular |
| UXD-3 | Drawers for editing, dialogs only for confirmation | Keeps list context while editing |
| UXD-4 | One app with role-based actions, not one app per role | Users hold several roles at once |
| UXD-5 | AI suggestions in a separate, labeled card with an explicit "copy" action | Enforces "AI never comments on its own" and lets us measure copies (PRD M4) |
| UXD-6 | One shared button system with tones by intent (§ 8) | The same action looked different on every page |
| UXD-7 | Overview shows the whole active cycle, split into Round 1 and Round 2 | Agreed with Ángel and Mariagiulia (2026-10-16): the QA admin compares both rounds without mixing their data |
| UXD-8 | One QA stage vocabulary for Overview, Results and Review (§ 7) | Two vocabularies (old statuses + "QA round") made the same result read differently per screen |
| UXD-9 | Each timeline has its own stages, shown in a "View stages" pop-up; no global stage card | A global card mixed the official timeline with sub-timelines |
| UXD-10 | Cycle shows only the active cycle; no closed-cycle browsing or "New cycle" | Ángel (2026-10-21): past cycles are not needed and everything is configured on the active phase |
| UXD-11 | One visible name for the active cycle everywhere: "Annual report 2026" | "2026 cycle" and "Official timeline" came from the mockup, not from the business; provisional until Ángel confirms |
| UXD-12 | Results filters by hierarchy: the timeline as a context line, then search · QA stage · program · type · assessor | Many sub-timelines can exist, so a tab row would grow without limit; the context line makes it clear what is being viewed |
| UXD-13 | Publish-type actions live in a sticky bottom bar that appears only with pending changes | The header stays calm and the action is always in reach |
| UXD-14 | Calm, specific styling: sentence case, no icons in group headings, tabular figures in the app font, plain counts, color only for risk | Earlier passes read as generic and AI-made; each removed element had no job |

## 13. Open Gaps / Open Questions

- Program response screen (PRD OQ-5).
- History and snapshot diff screen.
- TPB and PPU queues: separate list views or filters on Results?
- "AI match" in the mockup vs. v1 AI behavior (PRD OQ-8).
- Dashboard content beyond the Overview mockup.
- Which QA stage "Awaiting response" and "Answered" fall into (today: round 1 Awaiting response → Assessed by 2; round 2 Answered → Assessed, Awaiting response → Pending). Business to confirm.
- Automatic results are not visible on any screen. Do admins need to see them?
- Names: "Annual report 2026" for the active cycle and "Official timeline" as its type are provisional (Ángel). What happens with the 2027 cycle is open (`docs/qa-context.md`).
- The "previous outcome" of a result (first assessment) is no longer shown in Results.
- The Overview lost the "Stage N closed with X results uncorrected" warning; closed-stage summaries in the pop-up cover it in part. Stages in the pop-up do not link to Results.
- Should the timeline selector in Results keep its search box?
- Spartan sets `aria-invalid="true"` on an empty required field before it is touched, so a screen reader may announce it early (spartan is shared code — Yeck).
- Contrast: the "Pending" badge and some grey texts are ≈ 2.9:1, below AA.
- Not verified yet: dark mode on Results, Fields and the Overview stages pop-up; the sidebar on the phone menu.
- Notifications (provisional, not a priority) — questions to settle with María Julia and the business:
  - Which events are "Needs you" and which are "Updates" (spec OQ-1).
  - Each escalation one by one, or a daily count (OQ-2).
  - Whether Notifications also needs a sidebar item; today it is reached only from the bell (OQ-6).
  - How a later load of a timeline shows its size (OQ-7).
- Some shared kit parts still use `--text-muted` (≈ 3.0:1), below AA: `qa-menu`, `qa-tabs`, `qa-date-picker`, `qa-pagination` and `qa-badge`. `qa-select` and `qa-multi-select` moved to `--text-4` (2026-10-27).
