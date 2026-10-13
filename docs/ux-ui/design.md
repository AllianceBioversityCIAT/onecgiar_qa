# OneCGIAR QA — UX/UI Design

| | |
|---|---|
| Status | Draft v0.1 |
| Last updated | 2026-10-13 |
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
├── Overview          — cycle progress, counts per state and result type
├── Results           — table with filters → Result review (/results/:code)
│   └── Result review — field-by-field evaluation, comments, history tab
├── Cycle             — cycles, windows, batches (admin)
├── Fields            — field configuration per result type (admin)
└── Assessors         — users, roles and scopes (admin)
```

Routes on the mockup branch: `login`, `''` (overview), `results`, `results/:code`, `cycle`, `fields`, `assessors`.

## 3. Primary User Flows

| Flow | Steps | Screens |
|---|---|---|
| Configure a cycle | Create cycle → add windows → add batches → configure fields per result type | Cycle, Fields |
| Open a batch | Open batch → ingestion runs → results appear with ingestion status | Cycle (load drawer), Results |
| Assess a result | Open result → per field: approve or comment (AI suggestion available) → submit | Results → Result review |
| Respond as program | Open result → per comment: accept / accept with comment / disagree / clarify | Result review (**no mockup yet**, OQ-5) |
| Escalate & decide | Lead escalates core-field disagreement → TPB decides → PPU marks Done | Result review (comment thread actions) |
| Audit a result | Open result → History tab → compare snapshots | Result review |

## 4. Screen Inventory

| Screen | Status | Primary roles | Notes |
|---|---|---|---|
| Login | Mockup + stub auth (`feat/auth-login`) | All | SSO and custom login (Cognito via auth microservice) |
| Overview | Mockup | All | Cards and charts per cycle |
| Results | Mockup | All | Table, filters, status chips |
| Result review | Mockup (`review/`) | Assessor, Lead, TPB, PPU, Program | Field list + detail panel with "AI match" |
| Cycle | Mockup | Admin | Phases + batches, load drawer |
| Fields | Mockup | Admin | Per result type configuration |
| Assessors | Mockup | Admin | Drawer to edit roles and result types |
| Program response | **Missing** | Program | OQ-5 |
| History / snapshot diff | **Missing** | All | Needs design in the `history` spec |
| UI gallery | Dev-only | — | `ui/ui-gallery.ts` |

## 5. Navigation Model

- Persistent left navigation (`shell/qa-shell`) with the workspace sections; admin-only sections hidden for users without ADMIN.
- Top bar: current cycle selector, user menu (roles, sign out).
- Deep links work for every result (`/results/:code`); the review page keeps filters on return.
- Drawers for edit-in-place (load batch, edit assessor); dialogs only for confirmations.

## 6. Layout Patterns

| Pattern | Use |
|---|---|
| Shell + content | Every workspace page |
| Filter bar + data table | Results, Assessors |
| List + detail split | Result review (fields on the left, field detail and thread on the right) |
| Cards grid | Overview |
| Right drawer | Create/edit forms that keep context (batch load, assessor roles) |
| Timeline / stepper | Cycle windows and batches |

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
| Charts | `--chart-1…4` (teal ramp) |
| Elevation | `--shadow-pop`, `--shadow-seg`, `--overlay` |
| Type scale | `--fs-10 … --fs-30`, scaled by `--fs` (user font-size preference) |
| Font | `Manrope, system-ui, sans-serif` |

Login screens use the separate palette set in `client/src/app/theme/palettes.ts` (tonal palettes, accents ≥ 4.5:1 on white).

## 8. Component Inventory

Reuse before creating; style with Tailwind on top of these.

| Layer | Components |
|---|---|
| spartan/ui (`client/src/app/spartan/`) | alert, button, card, field, separator, spinner |
| QA kit (`client/src/app/ui/`) | badge, date-picker, dialog, drawer, menu, multi-select, progress, segmented, select, switch, tabs, tooltip |
| Shell | `shell/qa-shell` |
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

## 13. Open Gaps / Open Questions

- Program response screen (PRD OQ-5).
- History and snapshot diff screen.
- TPB and PPU queues: separate list views or filters on Results?
- "AI match" in the mockup vs. v1 AI behavior (PRD OQ-8).
- Dashboard content beyond the Overview mockup.
