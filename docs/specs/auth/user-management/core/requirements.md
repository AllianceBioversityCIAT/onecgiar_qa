# User management (core) — Requirements

## 1. Document Control

| | |
|---|---|
| Spec path | `docs/specs/auth/user-management/core` |
| Family | `docs/specs/auth/user-management/family.md` — child 1 of 2 |
| Type | Change |
| Depth | Full (authorization, data model, API, two external integrations) |
| Jira | P2-3908 (epic P2-3902) |
| Approval Mode | gated |
| Status | Draft |
| PRD stories | US-3, US-12; personas § Roles |
| Source | `../proposal.md` + decisions of 2026-10-19 (below) |
| Scope | Server only (`server/`) |
| Last updated | 2026-10-19 (FR-4 ADMIN exception — DD-13) |

**Decisions taken before writing (back lead, 2026-10-19):**

| # | Decision |
|---|---|
| D1 | GUEST and SSO self-registration stay as they are |
| D2 | A Lead Assessor keeps the assessor permissions; one user cannot be Assessor **and** Lead Assessor for the same result type. The front's `lead` switch **is** the Lead Assessor role |
| D3 | The QA Admin can do everything (user management and every review step) |
| D4 | Users get a nickname |
| D5 | Science Program scope is a filter applied after the role; conflict-of-interest exclusions come from Reporting automatically (child 2) and from the admin manually |
| D6 | PROGRAM is not grantable from user management; its future is decided in the comments spec |
| D7 | Creating a custom-account user creates their Cognito account (Cognito emails the temporary password) |
| D8 | The Science Program catalog comes from CLARISA; its id is canonical |
| D9 | Timelines are out of this spec; the visibility rule must accept a timeline filter later |

## 2. Executive Summary

The QA Admin gets an API to run the assessment team: create people (and their Cognito account when they do not use CGIAR SSO), give each one a nickname, roles per result type, the Science Programs they review and the programs they are blocked from for conflict of interest, deactivate them, and find them in a searchable list. Every change is audited and takes effect on the user's next request. This replaces the front's mock data behind the "Assessors" screen (PRD P4: coordination depends on the tech team to change assignments).

## 3. Glossary

| Term | Meaning |
|---|---|
| QA Admin | A user holding the ADMIN role (the front calls it "QA lead") |
| Team member | A user with at least one active role assignment, or created by a QA Admin |
| GUEST | An authenticated user with no active assignment (PRD US-12); created automatically on first SSO login |
| Account type | `sso` (CGIAR directory, no password in QA) or `custom` (Cognito user and password) |
| Grantable role | ADMIN, ASSESSOR, LEAD_ASSESSOR, TPB, PPU. PROGRAM is not grantable here (D6) |
| Result type scope | For ASSESSOR / LEAD_ASSESSOR: a list of result types, or **all** (which includes result types added later) |
| Program scope | The Science Programs a user reviews: a list, or **all** (empty = all, including programs added later) |
| Exclusion | A Science Program a user must never review (conflict of interest), with a reason. Origin `manual` (admin) or `reporting` (child 2). An exclusion always wins over the program scope (an active ADMIN is exempt — DD-13) |
| Dismissed exclusion | A `reporting` exclusion an admin set aside, keeping who, when and why |
| Effective scope | Role → result types → program scope minus active exclusions (→ timeline, later); an active ADMIN skips the scope and exclusion steps (DD-13) |

## 4. System Context & Scope

**In scope:** user-management API for QA Admins; nickname; result-type and program scopes; manual exclusions (storage ready for `reporting` ones); Cognito account creation and invitation resend for custom users; deactivation; catalogs (grantable roles, result types, Science Programs); audit records; `/auth/me` nickname; ADMIN grants every permission.

**Out of scope:** front-end work; the Reporting sync of exclusions (child 2); timelines (D9); per-result assignment; email notifications beyond the one Cognito sends; progress per member (needs results); permanent deletion; the PROGRAM role's future (D6).

**Current behavior:**

| # | Today | Evidence |
|---|---|---|
| C1 | No user-management routes exist | `grep -rn "@Controller(" server/src` → app, auth, me, session only (`origin/staging-center` @ `8866e69`) |
| C2 | An assignment carries one scope (global, result type **or** program) | `server/src/database/drizzle/schema/role-assignments.ts:57` |
| C3 | No nickname column | `server/src/database/drizzle/schema/users.ts:28-29` |
| C4 | Every admission overwrites first/last name from the id token | `server/src/auth/admission.service.ts:195`, `:305` |
| C5 | ADMIN grants only `ADMIN_ACCESS`; LEAD_ASSESSOR grants lead + assessor | `server/src/users/permissions.ts:51`, `:57` |
| C6 | Nothing prevents ASSESSOR and LEAD_ASSESSOR active for the same result type (different roles → different active keys) | `server/src/database/drizzle/schema/role-assignments.ts:47-54` (`active_key` includes `role_id`) |
| C7 | QA calls Cognito only with the app client secret; it holds no AWS credentials for the user pool's admin API | `server/src/auth/cognito-auth.client.ts` (no `Admin*` operation); `server/src/config/auth.config.ts` |
| C8 | The front lists, edits and "removes" team members on mock data | `client/src/app/pages/workspace/assessors/assessors.mock.ts:1-2`, `assessors-view.ts:270-334` |

## 5. Stakeholders / Personas

| Role | Scope | Needs |
|---|---|---|
| QA Admin (ADMIN) | Global | Create, find, edit and deactivate team members without the tech team |
| Assessor / Lead Assessor | Per result type | See only their effective scope; be shown by nickname |
| TPB, PPU | Global | Same, for their steps |
| GUEST | — | Unchanged; never sees another user's full name or email |
| Front team | — | A contract that replaces `assessors.mock.ts` |

## 6. Functional Requirements

### FR-1: Admin-only access
Every user-management and catalog route SHALL require the `ADMIN_ACCESS` permission.

#### Scenario: Non-admin
- GIVEN an authenticated Assessor, TPB, PPU or GUEST
- WHEN they call any user-management route
- THEN 403 with code `AUTH_PERMISSION_DENIED`, and nothing changes
- BUT it must NOT reveal whether the target user exists

#### Scenario: No token
- THEN 401 `AUTH_TOKEN_INVALID`

### FR-2: Create a user
A QA Admin SHALL create a user with email, full name, nickname, account type, roles with their result-type scope, program scope and manual exclusions.

#### Scenario: SSO user
- GIVEN account type `sso`
- WHEN the admin creates the user
- THEN the user exists in QA, active, with no Cognito call
- AND on their first SSO login they are linked to this record (not created as GUEST)

#### Scenario: Custom user, new to the pool
- GIVEN account type `custom` and an email with no Cognito account
- WHEN the admin creates the user
- THEN QA creates the Cognito account (verified email, the given names) and Cognito emails a temporary password
- AND the first login asks for a new password (`auth/cognito-native-session#FR-4`)

#### Scenario: Custom user who already has a Cognito account
- GIVEN the email already exists in the shared pool
- THEN QA creates only the QA record, sends no email, and reports `invitation: existing-account`
- BUT it must NOT change the existing Cognito account

#### Scenario: Validation and uniqueness
- AND IT MUST reject, with `VALIDATION_FAILED` per field, a malformed email, an empty full name or nickname, a nickname over 50 characters, an unknown role, result type or program, and a non-grantable role (PROGRAM)
- AND IT MUST answer 409 `USERS_EMAIL_TAKEN` for an email already in QA (case-insensitive) and 409 `USERS_NICKNAME_TAKEN` for a nickname already used (case-insensitive)
- BUT a failed creation must NOT leave a QA record behind

#### Scenario: Cognito unavailable (custom)
- THEN 503 `AUTH_SERVICE_UNAVAILABLE` and no QA record is created

### FR-3: Roles and result-type scope
The system SHALL let a QA Admin grant ADMIN, TPB and PPU globally, and ASSESSOR or LEAD_ASSESSOR for a list of result types or for **all** result types.

#### Scenario: Mixed roles
- GIVEN a user
- WHEN the admin makes them Lead Assessor for type A and Assessor for type B
- THEN both hold, and the Lead also has the assessor permissions for A (D2)

#### Scenario: Assessor and Lead on the same type
- WHEN the result would make the user Assessor and Lead Assessor for the same result type — including through **all**
- THEN 409 `USERS_ROLE_CONFLICT` and nothing changes

#### Scenario: All result types
- GIVEN a Lead Assessor for **all**
- WHEN a new result type appears in the catalog
- THEN the user covers it without any edit

#### Scenario: Replacing roles
- WHEN the admin saves a new set of roles and scopes
- THEN removed grants are revoked (history kept) and new ones become active
- BUT it must NOT revoke and re-grant an unchanged grant

### FR-4: Program scope and exclusions
The system SHALL keep, per user, a program scope (a list, or all including future programs) and a set of exclusions; an active exclusion always removes its program from the user's effective scope — except for a user holding an active ADMIN grant, who is never blocked by a conflict of interest (D3; design DD-13, back lead 2026-10-19).

#### Scenario: Manual exclusion
- WHEN the admin blocks program P for a user, with a reason
- THEN P is excluded, recorded as `manual` with who, when and the reason
- AND it is excluded even if P is in the program scope (for a non-admin; an active ADMIN is exempt — DD-13)

#### Scenario: Remove a manual exclusion
- THEN it is no longer active and its history (who removed it, when) is kept

#### Scenario: Dismiss a `reporting` exclusion
- GIVEN an exclusion of origin `reporting`
- WHEN the admin dismisses it with a reason
- THEN it stops excluding, and who, when and why are kept
- AND IT MUST require a reason

#### Scenario: Validation
- AND IT MUST reject an unknown program id with `VALIDATION_FAILED`

### FR-5: Edit a user
The system SHALL let a QA Admin change a user's nickname, roles, result-type scope, program scope and exclusions at any time.

#### Scenario: Name and email
- AND IT MUST NOT change the email
- AND the full name MAY be changed only while the user has never signed in; after that it comes from the identity provider on each login

#### Scenario: Unknown user
- THEN 404 `USERS_NOT_FOUND`

### FR-6: Changes take effect on the next request
After any change to a user, that user's next authorization decision SHALL use the new data within 60 seconds on any API instance, and immediately on the instance that made the change.

#### Scenario: Role removed mid-cycle
- GIVEN an Assessor using QA
- WHEN the admin removes the role
- THEN their next request on the same instance is refused, and on any instance within 60 s

### FR-7: Deactivate and reactivate
The system SHALL let a QA Admin deactivate and reactivate a user; users are never deleted.

#### Scenario: Deactivated user
- THEN they cannot log in (403 `AUTH_USER_INACTIVE`), their session refresh fails, and their requests are refused within FR-6's bound
- AND their past actions keep their name and nickname
- BUT it must NOT disable or delete their Cognito account (the pool is shared with other applications)

#### Scenario: Last admin
- WHEN a change would leave no active QA Admin (deactivation or role removal, including on oneself)
- THEN 409 `USERS_LAST_ADMIN` and nothing changes
- AND IT MUST hold when two admins act at the same time

### FR-8: Resend the invitation
The system SHALL let a QA Admin resend the Cognito invitation of an active custom user who has never signed in (DD-15).

#### Scenario: Not applicable
- WHEN the user is `sso`, has signed in, is deactivated (DD-15, back lead 2026-10-19), or their account pre-existed in the pool
- THEN 409 `USERS_INVITATION_NOT_APPLICABLE`

### FR-9: List and find users
The system SHALL list users with: name, nickname, email, account type, status, roles with their result-type scope, program scope, active exclusions, last sign-in (or never), and invitation state.

#### Scenario: Search and filters
- WHEN the admin searches by part of name, nickname or email, or filters by role, result type, program, status or "has exclusions"
- THEN only matching users are returned
- AND by default only team members are listed; GUESTs appear only with an explicit filter

#### Scenario: Pagination
- AND IT MUST paginate with a cursor (default 50, maximum 200)

### FR-10: User detail
The system SHALL return one user with everything in FR-9 plus exclusion history (active, removed and dismissed).

### FR-11: Catalogs
The system SHALL serve the grantable roles, the result types (key and display name) and the Science Programs (CLARISA id, code and name) for the forms.

#### Scenario: Upstream down
- WHEN the catalog source does not answer and no cached copy exists
- THEN 503 `SERVICE_UNAVAILABLE`
- BUT a cached copy no older than 24 h MAY be served instead

### FR-12: Nickname exposure
Every response that shows a user other than the caller to a non-admin SHALL show the nickname and never the full name or email; QA Admins see both.

#### Scenario: Own profile
- `GET /auth/me` returns the caller's nickname (null for a GUEST without one)

### FR-13: Audit
Every change made through this API (create, edit of each field, role grant or revoke, scope change, exclusion add, remove or dismiss, deactivate, reactivate, invitation resend) SHALL be recorded with the actor, the time, the user affected, and the values before and after.

#### Scenario: Failed change
- BUT a refused or failed change must NOT leave an audit record of a change that did not happen

### FR-14: QA Admin holds every permission
The ADMIN role SHALL grant every permission in the catalog, present and future (D3).

## 7. Non-Functional Requirements

| ID | Attribute | Scenario | Measure | TRD |
|---|---|---|---|---|
| NFR-1 | Security | Non-admin on any user-management route | 100 % → 403; checked by the route inventory and a per-route test | QAS-SEC-2 |
| NFR-2 | Security / privacy | Logs of user-management calls | No email, name, temporary password or AWS credential in any log line; decisions logged with user ids only | QAS-OBS-1 |
| NFR-3 | Availability | Cognito admin API or CLARISA slow or down | Answer 503 within 10 s; other routes unaffected | QAS-AVL-1 |
| NFR-4 | Performance | List of 500 team members, warm | p95 ≤ 300 ms per page, measured over ≥ 200 requests | QAS-PERF-1 |
| NFR-5 | Integrity | Concurrent edits | The DB enforces unique email, unique nickname (case-insensitive), at most one active grant per user/role/scope, and the last-admin rule under concurrency | TRD § 5.1 |

### Defect classes and their gates

| Defect class | Gate | Substitute / accepted risk |
|---|---|---|
| Route reachable by a non-admin | e2e route inventory + per-route 403 tests | — |
| Assessor/Lead overlap slips through (incl. **all**) | Unit table tests over every overlap shape | — |
| Exclusion not winning over scope; wildcard wrong | Unit tests of the effective-scope function | — |
| Last-admin rule broken by concurrency | Unit tests with a snapshot fake (as DD-10 of the auth spec) | **Real MySQL locking unverified** — HITL on `qadb` (no disposable DB) |
| Cognito admin contract drift (create, existing user, resend) | Contract tests with fixtures shaped like the Cognito API | Real pool: HITL smoke |
| CLARISA / Reporting catalog drift | Fixture-based client tests | Real APIs: HITL smoke |
| PII leak to non-admins or to logs | e2e body assertions + log spies | — |
| Audit gap | Unit/e2e: each mutation writes exactly one audit entry, none on refusal | — |
| Migration defect on shared `qadb` | Generated SQL review + `schema.spec` | Applied by a human at the HITL step |
| Compiler-only | `pnpm build` | — |
| Contract mismatch with the front | OpenAPI document test + review of the contract with the front team | Front integration is theirs |

## 8. Requirement ID Index

| ID | Title | Scenarios | Owning task(s) |
|---|---|---|---|
| FR-1 | Admin-only access | 2 | T-2, T-8 |
| FR-2 | Create a user | 5 | T-1, T-3, T-5, T-6, T-8, T-10 |
| FR-3 | Roles and result-type scope | 4 | T-3, T-6 |
| FR-4 | Program scope and exclusions | 4 | T-3, T-4, T-6 |
| FR-5 | Edit a user | 2 | T-6, T-8 |
| FR-6 | Changes take effect | 1 | T-4, T-6 |
| FR-7 | Deactivate / reactivate | 2 | T-4, T-6, T-10 |
| FR-8 | Resend invitation | 1 | T-5, T-6, T-10 |
| FR-9 | List and find | 2 | T-7, T-8 |
| FR-10 | Detail | — | T-7, T-8 |
| FR-11 | Catalogs | 1 | T-2, T-10 |
| FR-12 | Nickname exposure | 1 | T-8, T-9 |
| FR-13 | Audit | 1 | T-4, T-6, T-9 |
| FR-14 | ADMIN holds every permission | — | T-3 |
| NFR-1…5 | See § 7 | — | T-1–T-5, T-8–T-10 |
