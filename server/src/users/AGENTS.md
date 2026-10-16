# src/users — Agent Guide

Users, roles, role assignments and permission evaluation (design DD-1, § 7.1; FR-1…FR-3, FR-11). Other modules import `UsersModule` for `AuthorizationService` and the repositories — never the Drizzle stores directly. Root and `server/AGENTS.md` rules apply.

## Files

| File | Role |
|---|---|
| `users.module.ts` | Binds the store ports (`USERS_STORE`, `ROLE_ASSIGNMENTS_STORE`) to the Drizzle adapters; exports `UsersRepository`, `RoleAssignmentsRepository`, `AuthorizationService`, `CurrentUserCache` |
| `permissions.ts` | The closed permission catalog (`Permission`), `RoleCode`, and `ROLE_DEFINITIONS` (each role's scope type and granted permissions) |
| `authorization.service.ts` | `can(user, permission, ctx)` — resource-scoped, pure, fails closed without the matching context; `canAny(user, permission)` — route-level |
| `users.repository.ts` | `UsersRepository` (rules: email normalized to lowercase, `cognito_sub` linked only when empty, duplicate → `DuplicateUserError`) over the `UsersStore` port; `DrizzleUsersStore` adapter |
| `role-assignments.repository.ts` | `RoleAssignmentsRepository` (scope must match the role's scope type, one active assignment per role+scope, revoke keeps history) over `RoleAssignmentsStore`; `DrizzleRoleAssignmentsStore` adapter |
| `current-user.cache.ts` | Per-process cache `sub → user + live assignments`, TTL 60 s (`CURRENT_USER_TTL_MS`), `invalidate(userId)`; `isLiveAssignment`, `isAdmitted`. Clock injectable via `CURRENT_USER_CLOCK` |
| `users.errors.ts` | `ScopeMismatchError`, `UnknownRoleError` (400), `DuplicateActiveAssignmentError`, `DuplicateUserError` (409), `AssignmentNotFoundError` (404), `InvalidEmailError`; `isDuplicateKeyError` for MySQL 1062 |
| `*.spec.ts` | Unit tests, including the full role × scope × context matrix (`authorization.matrix.spec.ts`) |

## Rules

- **Permissions are data, not code paths.** A new capability is a new `Permission` member plus the roles that grant it in `ROLE_DEFINITIONS`. Never write `if (user.role === 'ADMIN')`; call `can()` / `canAny()`.
- **Scope:** `global` roles have no scope key; `result_type` roles need a result type key; `program` roles need a program id. LEAD_ASSESSOR also grants the assessor permission within the same result type. `READ` is the marker every authenticated user holds (GUEST included).
- **Resource checks (DD-4):** the route guard only checks `canAny`. A handler that loads a scoped resource must then call `can(user, p, { resultType | programId })` itself — reviewers check this.
- **Writes go through the repositories,** which hold the rules the database cannot (scope vs role). Do not insert into `role_assignments` directly.
- **Cache freshness (FR-11):** any write that changes a user or their assignments must call `CurrentUserCache.invalidate(userId)` after the transaction commits. Other processes see the change within 60 s.
- **Locking (DD-10):** when a decision depends on concurrent writes, read with `{ forUpdate: true }` / `{ forShare: true }` (`ReadOptions`, `AssignmentReadOptions`), never a plain read. Lock order: `users` → `role_assignments` → `roles`.
- Adding a role or permission also needs: the seed (`src/database/seeds/seed.ts` uses `ROLE_DEFINITIONS`), the matrix test, and the spec.

## Testing

- Unit tests use the in-memory stores in `test/support/in-memory-stores.ts`; they emulate unique keys and the generated `active_key`, and count `writes` for "changes nothing" assertions.
- Extend `authorization.matrix.spec.ts` for every new permission or role: every role × scope × context must have an explicit expected result.
- Drizzle adapters are verified by type-check and generated-SQL assertions; there is no disposable MySQL for tests (shared `qadb` is never reset).
