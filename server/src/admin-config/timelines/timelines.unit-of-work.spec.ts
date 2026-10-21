// @akili-spec admin-config/cycle-timelines
import { drizzle } from 'drizzle-orm/mysql2';
import { IdempotencyFenceLostError } from '../../common/idempotency/idempotency.errors.js';
import * as schema from '../../database/drizzle/schema/index.js';
import { CatalogService } from '../../users/catalogs/catalog.service.js';
import { UpstreamUnavailableError } from '../../users/catalogs/catalogs.errors.js';
import type { AdminConfigContext } from '../admin-config.context.js';
import {
  CycleClosedError,
  TimelineAssignmentNotFoundError,
  TimelineNameTakenError,
} from '../admin-config.errors.js';
import type { TimelineCreateInput } from './timeline-rules.js';
import { TimelinesService } from './timelines.service.js';
import { DrizzleTimelinesStore } from './timelines.store.js';
import { DrizzleTimelinesUnitOfWork } from './timelines.unit-of-work.js';

// The real adapters over a stub MySQL driver: statements are asserted, as there
// is no disposable MySQL (the shared qadb is never touched). Expected values
// are design 7.2 / 7.3 written out: no statement before the rules pass, then
// READ COMMITTED, the cycle row FOR UPDATE first, the kind read under that
// lock, the timeline, its scope and steps, the key mark, commit; and what the
// two unique keys of `timelines` look like to the adapter.

const at = '2026-10-19 10:00:00';
const FIXED = new Date('2026-10-20T10:00:00.000Z');

interface Statement {
  via: 'pool' | 'tx';
  sql: string;
  params: unknown[];
}

// `cycles` columns in table order: id, year, status, active_key, created_at,
// created_by, activated_at, activated_by, closed_at, closed_by.
const draftCycle = [3, 2027, 'draft', null, at, 1, null, null, null, null];

const duplicate = (key: string) =>
  Object.assign(new Error(`Duplicate entry '3' for key '${key}'`), {
    code: 'ER_DUP_ENTRY',
    errno: 1062,
    sqlMessage: `Duplicate entry '3' for key '${key}'`,
  });

interface StubOptions {
  /** The cycle already has its official timeline. */
  official?: boolean;
  fenceRows?: number;
  /** Throws on the n-th insert into `timelines` (1-based) when it returns an error. */
  failInsert?: (attempt: number) => Error | undefined;
  /** A catalog source that cannot be reached, as an unreachable CLARISA or Reporting Tool. */
  catalogDown?: 'programs' | 'resultTypes';
  /** The status the cycle row is read with (default `active`). */
  cycleStatus?: 'draft' | 'active' | 'closed';
  /** The insert into `timeline_users` is refused with this error (1062 on the active key, or another). */
  assignmentInsertError?: Error;
  /** Rows the UPDATE of `timeline_users` matches (default 1). */
  removeRows?: number;
}

function stub({
  official = false,
  fenceRows = 1,
  failInsert,
  catalogDown,
  cycleStatus = 'active',
  assignmentInsertError,
  removeRows = 1,
}: StubOptions = {}) {
  const log: Statement[] = [];
  let timelineInserts = 0;
  const answer = (via: Statement['via']) => ({
    query: ({ sql }: { sql: string }, values?: unknown[]) => {
      log.push({ via, sql, params: values ?? [] });
      if (sql.startsWith('insert into `timelines`')) {
        const error = failInsert?.(++timelineInserts);
        if (error) return Promise.reject(error);
        return Promise.resolve([{ insertId: 11, affectedRows: 1 }, []]);
      }
      if (sql.startsWith('insert into `timeline_users`')) {
        if (assignmentInsertError) return Promise.reject(assignmentInsertError);
        return Promise.resolve([{ insertId: 31, affectedRows: 1 }, []]);
      }
      if (sql.startsWith('insert')) {
        return Promise.resolve([{ insertId: 0, affectedRows: 1 }, []]);
      }
      if (!sql.startsWith('select')) {
        const affectedRows = sql.startsWith('update `idempotency_keys`')
          ? fenceRows
          : sql.startsWith('update `timeline_users`')
            ? removeRows
            : 1;
        return Promise.resolve([{ affectedRows }, []]);
      }
      let rows: unknown[][];
      if (sql.includes('from `cycles`') && sql.endsWith('for share')) {
        rows = [[cycleStatus]];
      } else if (sql.includes('from `roles`')) rows = [[3]];
      else if (sql.includes('from `users`')) {
        // Ana (id 1), in table order: id, cognito_sub, cognito_username, email, first_name, last_name, auth_source, is_active, last_login_at, created_at, updated_at, created_by, nickname, invitation, invited_at.
        rows = [
          [
            1,
            'sub-ana',
            'ana',
            'ana@cgiar.org',
            'Ana',
            'Tester',
            'custom',
            1,
            null,
            at,
            at,
            null,
            null,
            'none',
            null,
          ],
        ];
      } else if (sql.includes('from `role_assignments`')) {
        // Her live grants as the view selects them: role code, role active, grant active, revoked at, result type key, program id.
        rows = [
          ['ASSESSOR', 1, 1, null, 'KP', null],
          ['TPB', 1, 1, null, null, null],
        ];
      } else if (
        sql.includes('from `timeline_users`') &&
        sql.includes('`active_key`')
      ) {
        // The active row of this user and role, in table order (id, timeline_id, user_id, role_id, assigned_at, assigned_by, removed_at, removed_by, active_key).
        rows = [[31, 11, 1, 3, at, 9, null, null, '11:1:3']];
      } else if (sql.includes('from `cycles`')) rows = [draftCycle];
      else if (sql.includes('`official_key` = ?')) rows = official ? [[7]] : [];
      else if (sql.includes('from `timeline_steps`'))
        rows = [
          [
            21,
            11,
            1,
            'Assessors',
            'assessors',
            '2026-11-02',
            '2026-11-06',
            1,
            1,
          ],
        ];
      else if (sql.includes('from `timeline_programs`')) rows = [[11, 2]];
      else if (sql.includes('from `timeline_result_types`'))
        rows = [[11, 'KP']];
      else if (sql.includes('from `timeline_users`')) rows = [];
      // A `timelines` row in table order (id, cycle_id, name, kind, official_key,
      // all_programs, all_result_types, created_at, created_by) plus the
      // timeline-edit columns: version 1, never edited (updated_at, updated_by).
      else
        rows = [
          [11, 3, 'July 2026', 'official', 3, 0, 0, at, 1, 1, null, null],
        ];
      return Promise.resolve([rows, []]);
    },
  });
  // A pool, as in production: a transaction takes one connection from it.
  const pool = {
    ...answer('pool'),
    getConnection: async () => ({ ...answer('tx'), release: () => {} }),
  };
  const db = drizzle({ client: pool as never, schema, mode: 'default' });
  const sources = {
    programs: {
      list: async () => {
        if (catalogDown === 'programs') throw new UpstreamUnavailableError();
        return [{ id: 2, code: 'SP02', name: 'Landscapes' }];
      },
    },
    resultTypes: {
      list: async () => {
        if (catalogDown === 'resultTypes') throw new UpstreamUnavailableError();
        return [{ key: 'KP', name: 'Knowledge product' }];
      },
    },
  };
  const service = new TimelinesService(
    new DrizzleTimelinesUnitOfWork(db),
    new DrizzleTimelinesStore(db),
    new CatalogService(sources.resultTypes, sources.programs, () => Date.now()),
    () => FIXED,
  );
  return { service, log };
}

const request: TimelineCreateInput = {
  name: 'July 2026',
  allPrograms: false,
  programIds: [2],
  allResultTypes: false,
  resultTypeKeys: ['KP'],
  steps: [
    {
      name: 'Assessors',
      audience: 'assessors',
      opensOn: '2026-11-02',
      closesOn: '2026-11-06',
      round: 1,
      requiresLoad: true,
    },
  ],
};

const ctx: AdminConfigContext = { actorId: 9, requestId: 'req-1' };
const keyedCtx: AdminConfigContext = {
  ...ctx,
  idempotency: {
    reservation: { actorId: 9, key: 'k-1', ownerToken: 'token-1' },
    outcome: 'none',
  },
};

const insertsInto = (log: Statement[], table: string) =>
  log.filter((s) => s.sql.startsWith(`insert into \`${table}\``));

describe('DrizzleTimelinesUnitOfWork over a stub MySQL driver', () => {
  it('a first create: READ COMMITTED, the cycle FOR UPDATE, then the official check, the timeline, scope, steps, the key mark, commit, all on the transaction connection', async () => {
    const { service, log } = stub();

    const result = await service.create(keyedCtx, 3, request);

    expect(result).toEqual({ timelineId: 11 });
    expect(log.slice(0, 2).map((s) => s.sql)).toEqual([
      'set transaction isolation level read committed',
      'begin',
    ]);
    const inTx = log.slice(
      log.findIndex((s) => s.sql === 'begin'),
      log.findIndex((s) => s.sql === 'commit') + 1,
    );
    expect(inTx.map((s) => s.via)).toEqual(inTx.map(() => 'tx'));
    expect(inTx[1]!.sql).toMatch(
      /from `cycles` where `cycles`\.`id` = \? limit \? for update$/,
    );
    expect(inTx[2]!.sql).toMatch(
      /from `timelines` where `timelines`\.`official_key` = \? limit \?$/,
    );
    expect(inTx[2]!.params[0]).toBe(3);
    expect(inTx[3]!.sql).toMatch(/^insert into `timelines`/);
    expect(inTx[4]!.sql).toMatch(/^insert into `timeline_programs`/);
    expect(inTx[5]!.sql).toMatch(/^insert into `timeline_result_types`/);
    expect(inTx[6]!.sql).toMatch(/^insert into `timeline_steps`/);
    expect(inTx[7]!.sql).toMatch(/^update `idempotency_keys`/);
    expect(inTx.at(-1)!.sql).toBe('commit');
    expect(inTx).toHaveLength(9);
    // The generated key is never written; the kind decides it.
    expect(inTx[3]!.sql).not.toContain('official_key');
    expect(inTx[3]!.params).toEqual(
      expect.arrayContaining([3, 'July 2026', 'official', 9]),
    );
  });

  it('is additional when the official check finds a row', async () => {
    const { service, log } = stub({ official: true });

    await service.create(ctx, 3, request);

    expect(insertsInto(log, 'timelines')[0]!.params).toContain('additional');
  });

  it('an unkeyed create marks nothing', async () => {
    const { service, log } = stub();

    await service.create(ctx, 3, request);

    expect(log.some((s) => s.sql.includes('idempotency_keys'))).toBe(false);
  });

  it('a lost fence (the mark matches no row) rolls the transaction back, with no commit', async () => {
    const { service, log } = stub({ fenceRows: 0 });

    await expect(service.create(keyedCtx, 3, request)).rejects.toBeInstanceOf(
      IdempotencyFenceLostError,
    );

    const sqls = log.map((s) => s.sql);
    expect(sqls).toContain('rollback');
    expect(sqls).not.toContain('commit');
  });

  it('a request that breaks a rule runs no statement at all', async () => {
    const { service, log } = stub();

    await expect(
      service.create(ctx, 3, { ...request, name: ' ' }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_FAILED' } });

    expect(log).toEqual([]);
  });

  it.each(['programs', 'resultTypes'] as const)(
    'a request whose %s catalog cannot be read is a 503 and runs no statement at all',
    async (catalogDown) => {
      const { service, log } = stub({ catalogDown });

      await expect(service.create(ctx, 3, request)).rejects.toMatchObject({
        response: { code: 'SERVICE_UNAVAILABLE' },
      });

      expect(log).toEqual([]);
    },
  );

  it('a duplicate name (1062 on `uq_timelines_cycle_name`) is TIMELINES_NAME_TAKEN: rolled back, no scope or steps written, no commit', async () => {
    const { service, log } = stub({
      failInsert: () => duplicate('timelines.uq_timelines_cycle_name'),
    });

    await expect(service.create(ctx, 3, request)).rejects.toBeInstanceOf(
      TimelineNameTakenError,
    );

    const sqls = log.map((s) => s.sql);
    expect(sqls).toContain('rollback');
    expect(sqls).not.toContain('commit');
    expect(insertsInto(log, 'timeline_steps')).toEqual([]);
    expect(insertsInto(log, 'timeline_programs')).toEqual([]);
  });

  it('a second official (1062 on `uq_timelines_official_key`) is retried once as additional, in the same transaction', async () => {
    const { service, log } = stub({
      failInsert: (attempt) =>
        attempt === 1
          ? duplicate('timelines.uq_timelines_official_key')
          : undefined,
    });

    const result = await service.create(ctx, 3, request);

    expect(result).toEqual({ timelineId: 11 });
    const inserts = insertsInto(log, 'timelines');
    expect(inserts.map((s) => s.params.includes('official'))).toEqual([
      true,
      false,
    ]);
    expect(inserts[1]!.params).toContain('additional');
    expect(inserts.map((s) => s.via)).toEqual(['tx', 'tx']);
    expect(log.filter((s) => s.sql === 'begin')).toHaveLength(1);
    expect(log.at(-1)!.sql).toBe('commit');
  });

  it('a 1062 on any other key is not read as a name or an official: it is thrown, and rolled back', async () => {
    const { service, log } = stub({
      failInsert: () => duplicate('timelines.PRIMARY'),
    });

    await expect(service.create(ctx, 3, request)).rejects.toMatchObject({
      cause: { code: 'ER_DUP_ENTRY' },
    });

    expect(log.map((s) => s.sql)).toContain('rollback');
  });

  it('a duplicate key wrapped as the cause of another error is still told apart by its key', async () => {
    const wrapped = Object.assign(
      new Error('Failed query: insert into timelines'),
      {
        cause: duplicate('timelines.uq_timelines_cycle_name'),
      },
    );
    const { service } = stub({ failInsert: () => wrapped });

    await expect(service.create(ctx, 3, request)).rejects.toBeInstanceOf(
      TimelineNameTakenError,
    );
  });

  it('reading one timeline is one statement per table (and one for the assignment counts), on the pool, and maps the rows', async () => {
    const { service, log } = stub();

    const timeline = await service.get(11);

    expect(log.map((s) => s.via)).toEqual([
      'pool',
      'pool',
      'pool',
      'pool',
      'pool',
    ]);
    expect(log.map((s) => /from `(\w+)`/.exec(s.sql)![1])).toEqual([
      'timelines',
      'timeline_steps',
      'timeline_programs',
      'timeline_result_types',
      'timeline_users',
    ]);
    expect(timeline).toMatchObject({
      id: 11,
      cycleId: 3,
      name: 'July 2026',
      kind: 'official',
      allPrograms: false,
      programIds: [2],
      allResultTypes: false,
      resultTypeKeys: ['KP'],
      steps: [
        {
          position: 1,
          name: 'Assessors',
          audience: 'assessors',
          opensOn: '2026-11-02',
          closesOn: '2026-11-06',
          round: 1,
          requiresLoad: true,
        },
      ],
    });
  });
});

const inTransaction = (log: Statement[]) =>
  log.slice(
    log.findIndex((s) => s.sql === 'begin'),
    log.findIndex((s) => s.sql === 'commit') + 1,
  );

describe('assign and remove over a stub MySQL driver (design 7.3, DD-9, DD-10)', () => {
  const command = { userId: 1, role: 'ASSESSOR' } as const;

  it('an assign: READ COMMITTED, the timeline, the cycle FOR SHARE, the user and her grants, the role id, the insert, commit, all on the one transaction connection', async () => {
    const { service, log } = stub();

    const result = await service.assign(ctx, 11, command);

    expect(result).toEqual({
      created: true,
      assignment: expect.objectContaining({
        assignmentId: 31,
        userId: 1,
        role: 'ASSESSOR',
      }),
    });
    expect(log.slice(0, 2).map((s) => s.sql)).toEqual([
      'set transaction isolation level read committed',
      'begin',
    ]);
    const inTx = inTransaction(log);
    expect(inTx.map((s) => s.via)).toEqual(inTx.map(() => 'tx'));
    expect(inTx[1]!.sql).toMatch(/from `timelines` where /);
    expect(inTx[2]!.sql).toMatch(
      /from `cycles` where `cycles`\.`id` = \? limit \? for share$/,
    );
    expect(inTx[2]!.params[0]).toBe(3);
    // The user and her live grants are read on the transaction's connection,
    // between the FOR SHARE and the insert: a pool read would hold a second
    // connection per assign while this one is held (design 7.3).
    expect(inTx[3]!.sql).toMatch(
      /from `users` where `users`\.`id` = \? limit \?$/,
    );
    expect(inTx[3]!.params[0]).toBe(1);
    expect(inTx[4]!.sql).toMatch(
      /from `role_assignments` inner join `roles` .* where \(`role_assignments`\.`user_id` = \?/,
    );
    expect(inTx[4]!.params[0]).toBe(1);
    expect(inTx[5]!.sql).toMatch(/from `roles` where `roles`\.`code` = \?/);
    expect(inTx[5]!.params[0]).toBe('ASSESSOR');
    expect(inTx[6]!.sql).toMatch(/^insert into `timeline_users`/);
    expect(inTx[6]!.params).toEqual(expect.arrayContaining([11, 1, 3, 9]));
    // The generated key is never written; `removed_at` decides it.
    expect(inTx[6]!.sql).not.toContain('active_key');
    expect(inTx.at(-1)!.sql).toBe('commit');
    expect(inTx).toHaveLength(8);
    // Nothing of the assign ran on the pool: one connection per assign.
    const reads = log.filter((s) =>
      /from `(users|role_assignments)`/.test(s.sql),
    );
    expect(reads.map((s) => [s.via, /from `(\w+)`/.exec(s.sql)![1]])).toEqual([
      ['tx', 'users'],
      ['tx', 'role_assignments'],
    ]);
  });

  it('a repeat (1062 on `uq_timeline_users_active_key`) is not an error: the active row is read and the transaction commits', async () => {
    const { service, log } = stub({
      assignmentInsertError: duplicate(
        'timeline_users.uq_timeline_users_active_key',
      ),
    });

    const result = await service.assign(ctx, 11, command);

    expect(result).toMatchObject({
      created: false,
      assignment: { assignmentId: 31 },
    });
    const sqls = log.map((s) => s.sql);
    expect(insertsInto(log, 'timeline_users')).toHaveLength(1);
    expect(sqls).toContain('commit');
    expect(sqls).not.toContain('rollback');
  });

  it('a 1062 on any other key is not read as a repeat: it is thrown and rolled back', async () => {
    const { service, log } = stub({
      assignmentInsertError: duplicate('timeline_users.PRIMARY'),
    });

    await expect(service.assign(ctx, 11, command)).rejects.toMatchObject({
      cause: { code: 'ER_DUP_ENTRY' },
    });

    const sqls = log.map((s) => s.sql);
    expect(sqls).toContain('rollback');
    expect(sqls).not.toContain('commit');
  });

  it('a closed cycle is refused after the FOR SHARE read, with no insert and a rollback', async () => {
    const { service, log } = stub({ cycleStatus: 'closed' });

    await expect(service.assign(ctx, 11, command)).rejects.toBeInstanceOf(
      CycleClosedError,
    );

    const sqls = log.map((s) => s.sql);
    expect(sqls.some((q) => q.endsWith('for share'))).toBe(true);
    expect(insertsInto(log, 'timeline_users')).toEqual([]);
    expect(sqls).toContain('rollback');
    expect(sqls).not.toContain('commit');
  });

  it("a remove is an UPDATE of `removed_at` and `removed_by` where the row is this timeline's and not removed yet, and never a DELETE", async () => {
    const { service, log } = stub();

    await expect(service.remove(ctx, 11, 31)).resolves.toBeUndefined();

    const inTx = inTransaction(log);
    expect(inTx.map((s) => s.via)).toEqual(inTx.map(() => 'tx'));
    expect(inTx[1]!.sql).toMatch(/from `timelines` where /);
    expect(inTx[2]!.sql).toMatch(/from `cycles` .* for share$/);
    const update = inTx[3]!;
    expect(update.sql).toMatch(
      /^update `timeline_users` set `removed_at` = \?, `removed_by` = \? where \(`timeline_users`\.`id` = \? and `timeline_users`\.`timeline_id` = \? and `timeline_users`\.`removed_at` is null\)$/,
    );
    expect(update.params.slice(1)).toEqual([9, 31, 11]);
    expect(inTx.at(-1)!.sql).toBe('commit');
    expect(inTx).toHaveLength(5);
    expect(log.some((s) => s.sql.startsWith('delete from'))).toBe(false);
  });

  it('a remove that matches no row is 404, rolled back, with no commit', async () => {
    const { service, log } = stub({ removeRows: 0 });

    await expect(service.remove(ctx, 11, 31)).rejects.toBeInstanceOf(
      TimelineAssignmentNotFoundError,
    );

    const sqls = log.map((s) => s.sql);
    expect(sqls).toContain('rollback');
    expect(sqls).not.toContain('commit');
  });

  it('the detail is six statements on the pool: the five of the read and one join of `timeline_users`, `users` and `roles`', async () => {
    const { service, log } = stub();

    const detail = await service.detail(11);

    expect(detail.users).toEqual([]);
    expect(log).toHaveLength(6);
    expect(log.map((s) => s.via)).toEqual(log.map(() => 'pool'));
    const joins = log.filter((s) =>
      /from `timeline_users` inner join `users` .* inner join `roles` /.test(
        s.sql,
      ),
    );
    expect(joins).toHaveLength(1);
    expect(joins[0]!.sql).toMatch(/`timeline_users`\.`removed_at` is null/);
    expect(joins[0]!.params).toContain(11);
  });
});
