import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  datetime,
  int,
  mysqlEnum,
  mysqlTable,
  varchar,
  type AnyMySqlColumn,
} from 'drizzle-orm/mysql-core';

export const authSources = ['sso', 'custom'] as const;
export type AuthSource = (typeof authSources)[number];

// State of the Cognito invitation (user-management FR-8): `existing_account`
// = the email already had a pool account, so QA sent nothing.
export const invitationStates = ['none', 'sent', 'existing_account'] as const;
export type InvitationState = (typeof invitationStates)[number];

const email = sql.identifier('email');

export const users = mysqlTable(
  'users',
  {
    id: int('id', { unsigned: true }).autoincrement().primaryKey(),
    cognitoSub: varchar('cognito_sub', { length: 64 }).unique(
      'uq_users_cognito_sub',
    ),
    // Set at login; needed to refresh the session (design DD-2).
    cognitoUsername: varchar('cognito_username', { length: 128 }),
    email: varchar('email', { length: 255 }).notNull().unique('uq_users_email'),
    firstName: varchar('first_name', { length: 100 }),
    lastName: varchar('last_name', { length: 100 }),
    authSource: mysqlEnum('auth_source', authSources).notNull().default('sso'),
    isActive: boolean('is_active').notNull().default(true),
    lastLoginAt: datetime('last_login_at'),
    createdAt: datetime('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .$onUpdate(() => new Date()),
    // null = created by the system.
    createdBy: int('created_by', { unsigned: true }).references(
      (): AnyMySqlColumn => users.id,
    ),
    // Declared last, in the order migration 0001 appends them to the table:
    // row readers that map by position (the admission stub driver) keep working.
    // Unique under the column's case-insensitive collation (NFR-5, P-7).
    nickname: varchar('nickname', { length: 50 }).unique('uq_users_nickname'),
    invitation: mysqlEnum('invitation', invitationStates)
      .notNull()
      .default('none'),
    invitedAt: datetime('invited_at'),
  },
  () => [
    // The comparison is binary on purpose: under the default case-insensitive
    // collation `email = LOWER(email)` is always true and would enforce nothing.
    // Column names are written unqualified (not `${t.email}`) so the emitted
    // SQL carries no `table`.`column` prefix inside the constraint.
    check(
      'chk_users_email_lowercase',
      sql`CAST(${email} AS BINARY) = CAST(LOWER(${email}) AS BINARY)`,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
