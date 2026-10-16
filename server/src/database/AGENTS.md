# src/database — Agent Guide

Persistence wiring: MySQL through Drizzle ORM (workflow state) and DynamoDB through the AWS SDK / ElectroDB (snapshots, TRD ADR-002). Root and `server/AGENTS.md` rules apply.

## Files

| Path | Role |
|---|---|
| `drizzle/drizzle.module.ts` | `MYSQL_POOL` (mysql2 pool from `DATABASE_URL`, `DATABASE_POOL_SIZE`) and `DRIZZLE` (`DrizzleDB` typed with the schema). Closes the pool on shutdown |
| `drizzle/drizzle.constants.ts` | DI tokens `DRIZZLE`, `MYSQL_POOL` |
| `drizzle/schema/` | Table definitions: `users.ts`, `roles.ts`, `role-assignments.ts`, re-exported by `index.ts`; `schema.spec.ts` pins the generated DDL |
| `dynamodb/dynamodb.module.ts` | `DYNAMODB_CLIENT` and `DYNAMODB_TABLE_NAME` for ElectroDB entities (`new Entity(schema, { client, table })`). `DYNAMODB_ENDPOINT` only for DynamoDB Local |
| `seeds/seed.ts` | Idempotent seed: the six roles from `ROLE_DEFINITIONS` and, if `SEED_ADMIN_EMAIL` is set, a first ADMIN. Run with `pnpm db:seed` |
| `../../drizzle/` | Generated migrations (`0000_*.sql`) and drizzle-kit metadata |

## Schema guarantees (design § 5, DD-7, DD-8)

- `users`: unique lowercase `email`, unique nullable `cognito_sub`; `cognito_username`, `auth_source` (`sso` | `custom`), names, `is_active`, `last_login_at`; CHECK that the email is lowercase.
- `roles`: unique `code`, `scope_type` (`global` | `result_type` | `program`), `is_active`.
- `role_assignments`: at most one scope column set (CHECK); a stored generated `active_key` with a unique index so two **active** assignments of the same role and scope cannot coexist, while revoked rows (`revoked_at`, `revoked_by`) never block a re-grant. History is never deleted.
- Expressions inside generated columns and CHECKs use unqualified column names on purpose (MySQL rejects qualified ones); keep that when editing.

## Migrations and seeds

```bash
cd server
pnpm db:generate     # drizzle-kit generate → new file in drizzle/ from the schema diff
pnpm db:migrate      # apply pending migrations to DATABASE_URL
pnpm db:seed         # build, then run the idempotent seed
pnpm db:studio       # browse the DB
```

- Change the schema in `drizzle/schema/*.ts`, then generate a new migration. **Never edit a migration that has been applied** anywhere; add a new one.
- **Agents never run `db:migrate` or `db:seed` against the shared dev DB (`qadb`), and never reset it.** Applying migrations and seeds there is a human (HITL) step; TEST/PROD are never touched by agents.
- Review generated SQL before committing: CHECKs, generated columns and index names must match the design.

## Rules

- Inject `DRIZZLE` (typed `DrizzleDB`) only in store adapters (`Drizzle*Store` classes) and unit-of-work classes that open a transaction and hand transaction-bound stores to a service (`DrizzleAdmissionUnitOfWork`). Services and controllers use repositories.
- Multi-statement decisions run in one transaction (see `src/auth/admission.unit-of-work.ts`); use `FOR UPDATE` / `FOR SHARE` reads where a decision depends on concurrent writes.
- Duplicate-key violations (MySQL 1062) are translated to typed 409 errors by the repositories (`isDuplicateKeyError`), never surfaced as 500.
- DynamoDB has no entities yet; when adding one, follow the `aws-serverless` skill and put the entity next to the module that owns it, built from the exported client and table name.

## Testing

- `schema.spec.ts` asserts the DDL drizzle generates (constraints, generated column, indexes).
- `seed.spec.ts` runs the seed over fakes: the six roles, a second run changes nothing, an admin-deactivated role stays deactivated, a role stored with another scope type is refused, the first ADMIN (created once, existing user only gets the missing assignment), absent/blank `SEED_ADMIN_EMAIL`, malformed email.
- There is no disposable MySQL; DB-level behavior is covered by DDL assertions and in-memory fakes, and confirmed at the HITL step.
