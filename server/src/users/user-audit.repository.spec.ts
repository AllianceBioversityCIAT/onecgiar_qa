import { drizzle } from 'drizzle-orm/mysql2';
import { InMemoryUserAuditStore } from '../../test/support/in-memory-stores.js';
import * as schema from '../database/drizzle/schema/index.js';
import {
  DrizzleUserAuditStore,
  UserAuditRepository,
} from './user-audit.repository.js';

// FR-13: one event per change, `{ field: { before, after } }`. The table is
// append-only by convention (T-1 review), so the API is insert + read only.

function setup() {
  const store = new InMemoryUserAuditStore();
  return { store, audit: new UserAuditRepository(store) };
}

describe('UserAuditRepository (FR-13)', () => {
  it('records an event with the actor, the user affected and the before/after values', async () => {
    const { audit } = setup();

    const event = await audit.record({
      userId: 7,
      actorId: 1,
      action: 'role_grant',
      changes: { role: { before: null, after: 'ASSESSOR:KP' } },
      requestId: 'req-1',
    });

    expect(event).toMatchObject({
      userId: 7,
      actorId: 1,
      action: 'role_grant',
      changes: { role: { before: null, after: 'ASSESSOR:KP' } },
      requestId: 'req-1',
    });
    expect(event.createdAt).toBeInstanceOf(Date);
    expect(event.id).toBeGreaterThan(0);
  });

  it('reads the events of one user, newest first, limited', async () => {
    const { audit } = setup();
    const at = (iso: string) => new Date(iso);
    const base = { actorId: 1, changes: { x: { before: 1, after: 2 } } };
    await audit.record({
      ...base,
      userId: 7,
      action: 'create',
      createdAt: at('2026-10-01T10:00:00Z'),
    });
    await audit.record({
      ...base,
      userId: 8,
      action: 'create',
      createdAt: at('2026-10-01T11:00:00Z'),
    });
    await audit.record({
      ...base,
      userId: 7,
      action: 'update',
      createdAt: at('2026-10-02T10:00:00Z'),
    });
    await audit.record({
      ...base,
      userId: 7,
      action: 'deactivate',
      createdAt: at('2026-10-02T10:00:00Z'),
    });

    const all = await audit.findByUserId(7);
    const first = await audit.findByUserId(7, 1);

    expect(all.map((e) => e.action)).toEqual([
      'deactivate',
      'update',
      'create',
    ]);
    expect(first.map((e) => e.action)).toEqual(['deactivate']);
  });

  it('exposes no way to change or delete an event: insert and read only', () => {
    const methods = (type: { prototype: object }) =>
      Object.getOwnPropertyNames(type.prototype)
        .filter((name) => name !== 'constructor')
        .sort();

    expect(methods(UserAuditRepository)).toEqual(['findByUserId', 'record']);
    expect(methods(DrizzleUserAuditStore)).toEqual(['findByUserId', 'insert']);
    for (const name of methods(InMemoryUserAuditStore)) {
      expect(name).not.toMatch(/update|delete|remove|purge|clear/i);
    }
  });
});

describe('DrizzleUserAuditStore (the real adapter over a stub driver)', () => {
  const at = '2026-10-19 10:00:00';
  function adapter() {
    const statements: string[] = [];
    const client = {
      query: (query: { sql: string }) => {
        statements.push(query.sql);
        if (query.sql.startsWith('insert')) {
          return Promise.resolve([{ insertId: 9, affectedRows: 1 }, []]);
        }
        return Promise.resolve([
          [
            [
              9,
              7,
              1,
              'update',
              {
                nickname: { before: 'a', after: 'b' },
              } /* mysql2 parses JSON columns */,
              null,
              at,
            ],
          ],
          [],
        ]);
      },
    };
    const db = drizzle({ client: client as never, schema, mode: 'default' });
    return { store: new DrizzleUserAuditStore(db), statements };
  }

  it('inserts into user_audit_events and reads the row back', async () => {
    const { store, statements } = adapter();

    const event = await store.insert({
      userId: 7,
      actorId: 1,
      action: 'update',
      changes: { nickname: { before: 'a', after: 'b' } },
    });

    expect(statements[0]).toMatch(/^insert into `user_audit_events`/);
    expect(event).toMatchObject({
      id: 9,
      action: 'update',
      changes: { nickname: { before: 'a', after: 'b' } },
    });
  });

  it('reads newest first and never updates or deletes', async () => {
    const { store, statements } = adapter();

    await store.findByUserId(7, 20);

    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(
      /where `user_audit_events`\.`user_id` = \? order by `user_audit_events`\.`created_at` desc, `user_audit_events`\.`id` desc limit \?$/,
    );
    expect(statements.some((sql) => /^(update|delete)/.test(sql))).toBe(false);
  });
});
