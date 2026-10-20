import { sql } from 'drizzle-orm';
import {
  char,
  datetime,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  smallint,
  varchar,
} from 'drizzle-orm/mysql-core';
import { users } from './users.js';

export const idempotencyKeyStates = [
  'in_progress',
  'executed',
  'completed',
] as const;
export type IdempotencyKeyState = (typeof idempotencyKeyStates)[number];

// Remembered answers of keyed user-management writes (users-admin-write-safety
// FR-2..FR-7). The key is scoped to the admin: the PK is (actor_id, idem_key),
// so one admin's key never matches another's row (FR-6). `state` moves
// in_progress -> executed (marked inside the business transaction) ->
// completed (answer stored after commit); `lease_until` + `owner_token` fence a
// take-over of an abandoned in_progress row (DD-3).
export const idempotencyKeys = mysqlTable(
  'idempotency_keys',
  {
    actorId: int('actor_id', { unsigned: true })
      .notNull()
      .references(() => users.id),
    idemKey: varchar('idem_key', { length: 128 }).notNull(),
    // sha256 hex of method + route + canonical body; a different one under the
    // same key is a reuse (FR-4).
    fingerprint: char('fingerprint', { length: 64 }).notNull(),
    state: mysqlEnum('state', idempotencyKeyStates).notNull(),
    ownerToken: char('owner_token', { length: 36 }).notNull(),
    leaseUntil: datetime('lease_until').notNull(),
    // Success status of the route, for a replay after a crash between commit
    // and answer storage.
    routeStatus: smallint('route_status').notNull(),
    targetUserId: int('target_user_id', { unsigned: true }),
    responseStatus: smallint('response_status'),
    // `data`, or `{ code, fields }` for a refusal.
    responseBody: json('response_body'),
    createdAt: datetime('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    expiresAt: datetime('expires_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.actorId, t.idemKey] }),
    index('idx_idempotency_keys_expires').on(t.expiresAt),
  ],
);

export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type NewIdempotencyKey = typeof idempotencyKeys.$inferInsert;
