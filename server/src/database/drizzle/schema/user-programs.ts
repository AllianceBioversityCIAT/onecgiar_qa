import { int, mysqlTable, primaryKey } from 'drizzle-orm/mysql-core';
import { users } from './users.js';

// Program scope of a user (design 5, DD-4). NO rows = every program, current
// and future; rows = only those CLARISA programs. `program_id` is the CLARISA
// id, so it carries no FK.
export const userPrograms = mysqlTable(
  'user_programs',
  {
    userId: int('user_id', { unsigned: true })
      .notNull()
      .references(() => users.id),
    programId: int('program_id', { unsigned: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.programId] })],
);

export type UserProgram = typeof userPrograms.$inferSelect;
export type NewUserProgram = typeof userPrograms.$inferInsert;
