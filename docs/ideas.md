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
  7. The temporary palette switcher (`app-palette-switcher`) is hidden inside the workspace with CSS (`ui/tokens/qa-tokens.css`) and still shows on the login. Remove it from `app.html` once a palette is chosen.

## 2026-10-16 · Juanpa · Overview: Round 1 and Round 2 side by side

- **Idea** (agreed in a meeting with Ángel and Mariagiulia): split the Overview hero into a Round 1 column and a Round 2 column, so the QA admin can compare both rounds without mixing their data. Every number opens Results filtered by that stage.
  - Round 1: Pending · In review · Assessed by 1 assessor · Assessed by 2 assessors (knowledge products and other outputs finish round 1 after one check).
  - Round 2: Pending · Assessed (resolved by a lead assessor or a third-party broker).
  - "Quality assessed" is reserved for the final green state; the columns use "Assessed".
- **Done** (branch `jp-design/mockup-completo`, mock data): `overview/ov-cycle-hero.ts`, `overview/overview-view.ts`, `results/results.mock.ts` (`qaStage()`), `results/results-view.ts` (`?stage=` filter). Details in `docs/overview-rounds-2026-10-16.md`.
- **Verdict:** 🟡. The design and the drill-down work with mock data. The counts need the API.
- **What a developer needs to do (Yeck / Juanda):**
  1. The API must return each result's QA stage, and how many assessors have finished round 1. The mock derives both from the old status + round (`qaStage()`, marked `TODO(api)`).
  2. Business to confirm (Santi / Mariagiulia): in the mock, "Awaiting response" results in round 1 count as "Assessed by 2 assessors", and "Answered" count as "Round 2 · Pending".

## 2026-10-19 · Juanda · Email the assessor when a role is assigned or changed

- **Idea:** when a QA Admin grants, changes or removes a team member's role (or result types, programs, exclusions), QA sends that person an email saying what changed.
- **Today** (`docs/specs/auth/user-management/core`): no email on any role change. The only email is Cognito's temporary-password invitation, sent when a custom user new to the shared pool is created or the invitation is resent. It uses the pool's shared template, which may not mention QA (P-10). PRD § 5 keeps notifications out of v1, and the user-management spec lists "email notifications beyond the one Cognito sends" as out of scope.
- **Verdict:** 🔴. A new outbound channel: needs an email service (e.g. AWS SES on the CGIAR account — infrastructure), QA-branded templates, a decision on which events notify and whether people can opt out (business), and audit of what was sent. Not risky for the QA flow, but outside v1 scope.
- **What is needed:** a business decision (QA product, Santi) on events and wording; infrastructure (Cris) for the sender; then a spec of its own (`/akili-propose`), built on the `user_audit_events` rows the user-management spec already writes.

## 2026-10-19 · Juanda · QA-branded invitation email for custom users

- **Idea:** the temporary-password email that Cognito sends when a QA Admin creates a custom user should say it is for QA and link to the sign-in page.
- **Today** (validated in `docs/specs/auth/user-management/core`, T-10): Cognito's default template — sender `no-reply@verificationemail.com`, subject "Your temporary password", one line with the username (the email) and the temporary password. No QA or PRMS name, no link. The user pool is shared with other applications, so its templates are shared too.
- **Verdict:** 🟡. Needs the pool owner (Cris): a `CustomMessage` Lambda trigger on the shared pool that brands the message only for QA. QA would send `ClientMetadata` (e.g. `{ app: 'qa' }`) in `AdminCreateUser` so the trigger can tell QA's invitations apart — a small change in `CognitoAdminClient`.
- **What is needed:** agreement with the pool owner on the trigger (infrastructure); the email copy (QA product); then a small server change plus a real-pool smoke test.

## 2026-10-22 · Juanpa · Notifications for the QA Admin (review updates)

- **Idea:** a bell in the top bar and a Notifications page where María Julia (QA Admin) gets every update on the review of results: stages reached, program responses, escalations, TPB and PPU decisions, results that became Quality assessed, long waits, steps at risk and loads. In-app only; no email for now.
- **Done** (branch `jp-design/mockup-completo`): mockup in Claude Design (project "QA Platform", `notifications/Notifications.dc.html`), the spec `docs/specs/notifications/review-updates/`, and, since 2026-10-27, a **provisional** front on mock data: the bell in the top bar (admins only), its panel and the `/notifications` page.
- **Priority (Juanpa, 2026-10-27, from the team meeting):** not a priority. The section stays provisional; Juanpa will adjust it after the conversation with María Julia.
- **Verdict:** 🟡 as a front-only screen on mock data; 🔴 for real data (needs a server module, the `comments` / `escalation` / `ingestion` specs, and a change to PRD § 5, which keeps notifications out of v1).
- **What is needed:**
  1. Business (Santi / Ángel): decide whether in-app notifications for the ADMIN enter v1.
  2. María Julia: pick the panel layout (newest first vs "Needs you" first) and confirm the event list and the grouping.
  3. Juanda: a `notifications` server module and the new `notifications` domain in the `AGENTS.md` spec taxonomy, once the source specs exist.
