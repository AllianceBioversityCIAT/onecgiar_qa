# User management for QA admins — Proposal

## 1. Document Control

| | |
|---|---|
| Spec path | `docs/specs/auth/user-management` |
| Slug | `user-management` — derived from the free-text argument "User management for QA admins (Jira P2-3908), server only…" |
| Type | Change |
| Jira | P2-3908 (epic P2-3902) — commits use `<emoji> <type>(users) P2-3908: …` |
| Approval Mode | gated |
| Scope | **Server only** (`server/`). The front (`client/`) consumes the API; its screens are reference, not deliverable |
| Depends on | `auth/cognito-native-session` (done: users, roles, role assignments, `can()`, admission, response standard) · external: a Reporting endpoint for a user's programs (chunk 2 only) |
| Parallel-safe | no — changes the shared `users` / `role_assignments` schema and the permission catalog |
| PRD | US-3 (grant and revoke roles), personas (§ Roles), US-12 (GUEST) |
| TRD | § 5.1 (users, roles, role_assignments), § 6 (API, response standard), § 10 (authorization), ADR-004 (Reporting only through its API) |
| Branch | `feat/auth-user-management` (from `origin/staging-center` @ `8866e69`) |
| Date | 2026-10-19 |

## 2. Intent

Let the QA Admin run the assessment team without the tech team: add people, give each one a role per result type, a nickname, the Science Programs they review, and keep them away from the programs where they have a conflict of interest — through a server API the existing front "Assessors" screen can plug into.

## 3. Problem / Current Behavior

| # | Today | Evidence |
|---|---|---|
| 1 | There is no user-management API: the only controllers are health, auth, session and `me` | `grep -rn "@Controller(" server/src` → `app.controller.ts:12`, `auth/auth.controller.ts:88`, `auth/me.controller.ts:86`, `auth/session.controller.ts:90` |
| 2 | A role assignment has **one** scope: global, a result type **or** a program (DB CHECK); "program" is the scope of the PROGRAM role, not a filter for reviewers | `server/src/database/drizzle/schema/role-assignments.ts:57` (`chk_role_assignments_one_scope`) |
| 3 | No nickname: `users` stores first and last name only | `server/src/database/drizzle/schema/users.ts:28-29` |
| 4 | Every login overwrites first/last name from the id token | `server/src/auth/admission.service.ts:195`, `:305` |
| 5 | ADMIN grants only `ADMIN_ACCESS`; LEAD_ASSESSOR grants lead + assessor | `server/src/users/permissions.ts:51`, `:57` |
| 6 | Any new SSO user is created as GUEST (no assignments) | `server/src/auth/admission.service.ts:260-276` |
| 7 | The front "Assessors" screen exists on mock data, with `TODO(api)` at every mutation | `client/src/app/pages/workspace/assessors/assessors-view.ts:270-334`, `assessors.mock.ts:1-2` (scouted 2026-10-19) |

## 4. Proposed Outcome

- The QA Admin lists, searches, creates, edits and deactivates QA users through `/api/v1/users…`; nobody else can.
- Each user has a **nickname**, shown instead of the full name to everyone but the QA Admin.
- Roles are granted **per result type** for Assessor / Lead Assessor (one, several or **all**, including future types), globally for TPB, PPU and QA Admin. A Lead Assessor keeps the assessor permissions; the same user cannot hold Assessor and Lead Assessor for the same result type. The QA Admin can do everything.
- Each user has a **Science Program scope**: the programs they review (empty = all) **minus** conflict-of-interest **exclusions**. Exclusions come from Reporting automatically (programs where the user has a role there) and from the QA Admin manually; the QA Admin can dismiss an automatic one, and that decision is kept with who and when.
- Visibility for later result stories is one composable rule: role/result type → program scope → (timeline, added by its own story).
- Every change to a user is recorded with who and when.

## 5. Scope

**In (server):**
- Schema: `users.nickname`; program scope per user; `user_program_exclusions` (origin `reporting` / `manual`, active / dismissed, reason, who, when); "all result types" for an assignment; Assessor/Lead exclusivity; audit records.
- Endpoints (all `ADMIN_ACCESS`, response standard): users list (search by name/nickname/email; filters role, result type, program, status), detail, create, edit (nickname, roles, types, programs, exclusions), deactivate / reactivate; catalogs for roles, result types and Science Programs.
- `/auth/me` returns `nickname`.
- Permission catalog: ADMIN grants every permission.
- Chunk 2: Reporting sync of exclusions — in the background on user creation and on each login, plus a manual re-sync.
- OpenAPI for every route (per-route error codes), unit + e2e tests, docs (TRD § 5.1/§ 6, guides).

## 6. Non-Goals

- Any front-end work (the `client/` Assessors screen is the consumer, built by the front team).
- Timelines and assigning users to timelines (P2-3908 AC 10–11): their own story; only the visibility rule is left ready to take a timeline filter.
- Assigning individual results to individual users (Jira out of scope).
- Invitation emails / notifications (Jira out of scope) — see Open Question 3.
- Progress per member (reviewed / assigned) and "unreviewed results back to the pool": they need the results module.
- Permanent deletion of users.

## 7. Affected Users, Systems, And Specs

| Who / what | Effect |
|---|---|
| QA Admin | Manages the team through the API (front screen) |
| Assessors, Leads, TPB, PPU | Their nickname and scope are set by the admin; their effective permissions change if the admin edits them |
| GUEST (any SSO user) | Unchanged; sees nicknames, never full names |
| `server/src/users`, `server/src/auth` (admission, `me`), `server/src/database` (schema + migration) | Changed |
| Reporting (PRMS team) | New endpoint needed for chunk 2 |
| `auth/cognito-native-session` | Amended: name sync rule, ADMIN grants, nickname in the profile |
| Front team | New API contract to replace `assessors.mock.ts` |

## 8. Visual Reference

- Source: existing front implementation on `staging-center` (built from the QA Platform mockup).
- Location: `client/src/app/pages/workspace/assessors/` (`assessors-view`, `assessor-drawer`, `role-cell`, `types-cell`, `assessors.mock.ts`); `docs/ux-ui/design.md:37, :63, :73, :83`.
- Notes: used as the **contract reference** for the API shape; this spec delivers no UI. Contract gaps found are listed in § 9 and § 12.

## 9. Requirement Delta Preview

### ADDED Requirements
- User management endpoints restricted to `ADMIN_ACCESS` (AC 1, 2, 12, 14).
- Unique email (exists) and **nickname** per user, shown next to the full name for the QA Admin and alone for everyone else (AC 2–4).
- Program scope per user (include list, empty = all) and conflict-of-interest exclusions with origin, reason, dismissal and history (AC 9).
- "All result types" as a wildcard that covers types added later (AC 8).
- Deactivate / reactivate (AC 13) — the front's "Remove from team" maps to deactivate.
- Audit record of every user change with actor and time (AC 15).
- Catalog endpoints (roles, result types, Science Programs) with stable keys plus display names — the front uses display names (`'Knowledge product'`) and codes (`SP01`), the server keys and numeric ids.
- (Chunk 2) Exclusions synced from Reporting on creation and login, never overwriting manual or dismissed ones.

### MODIFIED Requirements
- Assessor/Lead: a user cannot hold Assessor and Lead Assessor for the same result type (AC 6); Lead keeps assessor permissions (decided with the back lead, 2026-10-19).
- ADMIN grants every permission (decided 2026-10-19).
- Name ownership: the full name comes from the IdP after the first login; the admin sets it only for a user who has not signed in (front: name not editable in edit mode, `assessor-drawer.ts:64-75`) — **proposed**, see Open Question 8.
- `/auth/me` profile gains `nickname`.

### REMOVED Requirements
- The single-scope rule for reviewers' programs (scope moves out of the assignment) — and possibly the PROGRAM role, see Open Question 1.

## 10. Approach Options

| Option | What | Pros | Cons |
|---|---|---|---|
| **A. Extend the current model** | Keep multi-assignment (`role_assignments` per result type), add per-user program scope + exclusions tables, expose a "team member" read model shaped for the front | Matches PRD/Jira (Lead for one type, Assessor for another); reuses `can()` and the cache | The front's "one role + `lead` flag" view must be mapped in the API |
| B. Mirror the front's model | One role per user + `lead` boolean | Simplest for the current UI | Cannot express AC 6 (Lead for some types, Assessor for others); throws away the existing model |
| C. Exclusions only from Reporting | No manual exclusions | Smaller | Fails AC 9 (admin selects programs) and the front's "Blocked for conflict of interest" rows with a reason |

## 11. Recommended Approach

**Option A, split in two chunks** (a spec family under `auth/user-management/`):

| # | Chunk | Depends on | Parallel-safe | Why first |
|---|---|---|---|---|
| 1 | **Core user management**: schema, users/assignments/programs/manual exclusions endpoints, catalogs, nickname, ADMIN-all, audit, `me` | `auth/cognito-native-session` | no | Unblocks the front now; no external dependency |
| 2 | **Reporting sync of exclusions** (create + login + re-sync) | chunk 1 + the Reporting endpoint | yes (own client + job) | Waits on the PRMS team; ships independently |

Smallest safe path: chunk 1 delivers every AC except the automatic part of AC 9, with the exclusion table already holding an `origin`, so chunk 2 adds a writer, not a schema change.

## 12. Risks, Dependencies, And Open Questions

**Dependencies**
- Reporting endpoint `GET …/users/{email}/programs` → `[{ programId, programName, role }]` (chunk 2; to request from the PRMS team).
- A source for the Science Program list and ids (CLARISA or Reporting).

**Risks**
- Contract drift with the front: roles are one-per-person in the UI (`TeamRole`, `assessors.mock.ts:5`) but many-per-user on the server; mitigated by a team-member read model and sharing the OpenAPI.
- Program identity: front codes `SP01…` vs numeric ids — decide the canonical key before chunk 1.
- Permission changes reach other API instances within ≤ 60 s (cache, DD-6); AC 12 says "immediately" — proposed to accept and document.

**Open questions**
1. **PROGRAM role:** with program membership living in Reporting, does PROGRAM leave QA (programs answer comments in the Reporting Tool)? The front has no PROGRAM screen or label.
2. **The front's `lead` switch** on an Assessor ("Can edit and delete other assessors' comments", `assessors.mock.ts:22-41`): is it the Lead Assessor role, or a separate permission?
3. **Invitations:** the front has "Send invitation" / "Resend invitation". Does the server create Cognito users or send emails (Jira: notifications out of scope)? Proposed: no; "invite" = pre-register.
4. **Science Program catalog:** CLARISA or Reporting, and which id is canonical?
5. **Result type catalog keys** (Reporting catalog keys vs display names).
6. **Nickname unique?** Proposed: yes (case-insensitive).
7. **"All"** result types / programs as a wildcard that includes future ones — proposed yes.
8. **Name ownership** (IdP vs admin) — proposed above.
9. **Audit depth** (AC 15): full audit log here, or a base table now and the "history and audit log" story later?
10. **Member activity** ("Active this week / never signed in"): served from `last_login_at` now; progress per type waits for the results module.

## 13. Success Criteria

- Every P2-3908 AC is mapped to a requirement or explicitly deferred (AC 10–11 → timeline story; AC 9 automatic part → chunk 2).
- The front can replace `assessors.mock.ts` with the API without changing its screens' behavior (contract checked against the scouted fields).
- No user can review a program they are excluded from; no non-admin sees a full name.
- Lint, build, unit and e2e green; OpenAPI lists every route and its error codes.

## 14. Next Step

On approval: write `docs/specs/auth/user-management/family.md` (two chunks above), then

```text
/akili-specify auth/user-management/core
```
