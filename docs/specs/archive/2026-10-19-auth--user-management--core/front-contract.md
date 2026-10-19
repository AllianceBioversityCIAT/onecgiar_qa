# User management API — contract notes for the front

Hand-off from `design.md` § 8 (spec `auth/user-management/core`). Server only; every route needs an **ADMIN** Bearer token and answers the standard envelope `{ success, data, meta }`. Routes, request bodies and error codes are in `design.md` § 6; the live shapes are in Swagger UI (`/api/v1/docs`).

## Quick path

1. Load the form catalogs: `GET /catalogs/roles`, `/catalogs/result-types`, `/catalogs/science-programs`.
2. List with `GET /users` (filters in `design.md` § 6), page with `meta.page.nextCursor`.
3. Mutate with the routes below; every mutation answers the full `UserDetail`, so replace the row with it.

## Rules the UI must follow

| Topic | Contract |
|---|---|
| Roles | Grouped per role: `{ role, resultTypes: 'all' \| string[] }`; global roles (ADMIN, TPB, PPU) carry no `resultTypes`. `PUT /users/:id/roles` replaces the whole set |
| `lead` switch | The single role + `lead` switch maps to `LEAD_ASSESSOR` for the chosen result types (D2). Assessor and Lead on the same type are refused: 409 `USERS_ROLE_CONFLICT` |
| Names of things | Result types are catalog **keys** (`/catalogs/result-types`); Science Programs are CLARISA **ids** (`/catalogs/science-programs`). Show the `name` from the catalog, send the key / id |
| Programs | `programs: 'all' \| number[]`. `[]` is **invalid** (400); send `'all'` instead |
| Exclusions | Active ones are `{ id, programId, origin, reason, since }` — no `createdBy`, no `reportingRole`. The history (`exclusionHistory`, detail only) carries who, when and why. Only `manual` ones can be removed; only `reporting` ones can be dismissed |
| "Remove from team" | `POST /users/:id/deactivate` (and `/activate` to restore). 409 `USERS_LAST_ADMIN` for the only admin |
| "Send invitation" | `POST /users` with `accountType: 'custom'` invites on create (`invitation: 'sent'`, or `'existing_account'` when the email already has a Cognito account); `POST /users/:id/invitation` resends, only for an **active** custom user with `invitation: 'sent'` who never signed in (an SSO user, a user who has signed in, a deactivated user, or a custom user with `invitation: 'existing_account'` or `'none'` gets 409 `USERS_INVITATION_NOT_APPLICABLE`, so hide the button for them). Cognito unreachable: 503 |
| Names | Two fields, `firstName` and `lastName`; editable only before the first sign-in (409 `USERS_NAME_LOCKED` after). The nickname is always editable and unique (409 `USERS_NICKNAME_TAKEN`) |
| Field errors | `error.fields[].field` uses brackets for array items and dots for nested objects: `roles[0].role`, `exclusions[0].reason`. An unknown key inside an item is `UNKNOWN_FIELD` on its own path |
| List paging | `meta.page.nextCursor` (opaque, `null` on the last page); send it back as `cursor`. `limit` 1–200, default 50 |
| `/auth/me` | Now includes the caller's own `nickname` (`null` for a GUEST without one) |
| Other users | Outside the admin screens, another user is shown by **nickname only** (FR-12); this API is the only place the email and full name appear |

## Front code to change

- `ApiMeta` (the front's copy of the envelope type) needs `page?: { nextCursor: string | null }` (ADR-007).

## Scope limits

Admin-only for now: listing, editing and scoping users. The Reporting-driven exclusions arrive in a later spec; the same `exclusions` shape will carry them (`origin: 'reporting'`).
