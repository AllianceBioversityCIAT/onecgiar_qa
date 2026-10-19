import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle/drizzle.constants.js';
import type { DrizzleDB } from '../database/drizzle/drizzle.module.js';
import {
  userAuditEvents,
  type NewUserAuditEvent,
  type UserAuditEvent,
} from '../database/drizzle/schema/user-audit-events.js';

export const USER_AUDIT_STORE = Symbol('USER_AUDIT_STORE');

/**
 * The persistence port of `UserAuditRepository`. Insert and read only: the
 * table is append-only by convention (T-1 review), so neither this port nor
 * the repository has an update or a delete.
 */
export interface UserAuditStore {
  insert(values: NewUserAuditEvent): Promise<UserAuditEvent>;
  /** Newest first (id descending breaks ties inside one second). */
  findByUserId(userId: number, limit: number): Promise<UserAuditEvent[]>;
}

export const DEFAULT_AUDIT_PAGE_SIZE = 50;

/**
 * Writer of `user_audit_events` (FR-13). It is built over the transaction of
 * the unit of work, so an event is committed together with the change it
 * records and is gone with it on a rollback; a refused change never reaches
 * `record`.
 */
@Injectable()
export class UserAuditRepository {
  constructor(
    @Inject(USER_AUDIT_STORE) private readonly store: UserAuditStore,
  ) {}

  /** One event per change, with `{ field: { before, after } }`. */
  record(event: NewUserAuditEvent): Promise<UserAuditEvent> {
    return this.store.insert(event);
  }

  findByUserId(
    userId: number,
    limit = DEFAULT_AUDIT_PAGE_SIZE,
  ): Promise<UserAuditEvent[]> {
    return this.store.findByUserId(userId, limit);
  }
}

type AuditDb = Pick<DrizzleDB, 'select' | 'insert'>;

/** Drizzle adapter of `UserAuditStore`. */
@Injectable()
export class DrizzleUserAuditStore implements UserAuditStore {
  constructor(@Inject(DRIZZLE) private readonly db: AuditDb) {}

  async insert(values: NewUserAuditEvent) {
    const [header] = await this.db.insert(userAuditEvents).values(values);
    const [event] = await this.db
      .select()
      .from(userAuditEvents)
      .where(eq(userAuditEvents.id, header.insertId))
      .limit(1);
    if (!event) throw new Error('Inserted audit event could not be read back');
    return event;
  }

  findByUserId(userId: number, limit: number) {
    return this.db
      .select()
      .from(userAuditEvents)
      .where(eq(userAuditEvents.userId, userId))
      .orderBy(desc(userAuditEvents.createdAt), desc(userAuditEvents.id))
      .limit(limit);
  }
}
