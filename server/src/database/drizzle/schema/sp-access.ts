// P2-3911 (SP view): the one-time link codes Reporting asks for and the SP
// sessions they are traded for. Only the SHA-256 (hex) of a code or a token is
// stored; the clear value exists only in the answer that issued it.
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  datetime,
  index,
  int,
  mysqlTable,
  varchar,
} from 'drizzle-orm/mysql-core';

// A code works once (`used_at` set by one conditional UPDATE) and lasts 60 s.
export const spLinkCodes = mysqlTable(
  'sp_link_codes',
  {
    id: bigint('id', { mode: 'number', unsigned: true })
      .autoincrement()
      .primaryKey(),
    codeHash: char('code_hash', { length: 64 })
      .notNull()
      .unique('uq_sp_link_codes_code_hash'),
    email: varchar('email', { length: 320 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    // CLARISA id of the Science Program; NULL only for a Reporting admin.
    programId: int('program_id', { unsigned: true }),
    isReportingAdmin: boolean('is_reporting_admin').notNull(),
    expiresAt: datetime('expires_at').notNull(),
    usedAt: datetime('used_at'),
    createdAt: datetime('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index('idx_sp_link_codes_expires').on(t.expiresAt)],
);

// An SP session (8 h). The bearer token is random, never signed.
export const spSessions = mysqlTable(
  'sp_sessions',
  {
    id: bigint('id', { mode: 'number', unsigned: true })
      .autoincrement()
      .primaryKey(),
    tokenHash: char('token_hash', { length: 64 })
      .notNull()
      .unique('uq_sp_sessions_token_hash'),
    email: varchar('email', { length: 320 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    programId: int('program_id', { unsigned: true }),
    isReportingAdmin: boolean('is_reporting_admin').notNull(),
    createdAt: datetime('created_at').notNull(),
    expiresAt: datetime('expires_at').notNull(),
  },
  (t) => [index('idx_sp_sessions_expires').on(t.expiresAt)],
);

export type SpLinkCode = typeof spLinkCodes.$inferSelect;
export type SpSession = typeof spSessions.$inferSelect;
