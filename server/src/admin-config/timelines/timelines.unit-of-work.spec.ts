// @akili-spec admin-config/cycle-timelines
import { drizzle } from 'drizzle-orm/mysql2';
import {
  InMemoryAdminConfigDatabase,
  InMemoryTimelinesUnitOfWork,
  collateName,
} from '../../../test/support/in-memory-admin-config.js';
import { IdempotencyFenceLostError } from '../../common/idempotency/idempotency.errors.js';
import * as schema from '../../database/drizzle/schema/index.js';
import { CatalogService } from '../../users/catalogs/catalog.service.js';
import { UpstreamUnavailableError } from '../../users/catalogs/catalogs.errors.js';
import type { AdminConfigContext } from '../admin-config.context.js';
import {
  CycleClosedError,
  TimelineAssignmentNotFoundError,
  TimelineNameTakenError,
  TimelineNotFoundError,
  TimelineVersionStaleError,
} from '../admin-config.errors.js';
import type { TimelineCreateInput } from './timeline-rules.js';
import { NoTimelineLoads } from './timeline-loads.js';
import { TimelinesService } from './timelines.service.js';
import { DrizzleTimelinesStore } from './timelines.store.js';
import {
  DrizzleTimelinesUnitOfWork,
  type TimelinesRepositories,
} from './timelines.unit-of-work.js';

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
  /** Rows the UPDATE of `timelines` matches (default 1): 0 is a lost version race (timeline-edit DD-6). */
  timelineUpdateRows?: number;
  /** The UPDATE of `timelines` is refused with this error (1062 on the name key, or another). */
  timelineUpdateError?: Error;
  /** Steps the timeline has: the select of `timeline_steps` returns this many rows (default 1). */
  stepCount?: number;
}

function stub({
  official = false,
  fenceRows = 1,
  failInsert,
  catalogDown,
  cycleStatus = 'active',
  assignmentInsertError,
  removeRows = 1,
  timelineUpdateRows = 1,
  timelineUpdateError,
  stepCount = 1,
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
      if (sql.startsWith('update `timelines`')) {
        if (timelineUpdateError) return Promise.reject(timelineUpdateError);
        return Promise.resolve([{ affectedRows: timelineUpdateRows }, []]);
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
        rows = Array.from({ length: stepCount }, (_, i) => [
          21 + i,
          11,
          i + 1,
          i === 0 ? 'Assessors' : `Step ${i + 1}`,
          ['assessors', 'programs', 'lead_assessors', 'tpb', 'ppu'][i],
          '2026-11-02',
          '2026-11-06',
          1,
          i === 0 ? 1 : 0,
        ]);
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
    new NoTimelineLoads(),
  );
  return { service, log, db };
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

// --- timeline edit: store and unit of work (timeline-edit T-4) ---------------
// Expected values are design 5, 7.2 step 8 and 7.3, FR-9, FR-10 and NFR-3/5
// written out. `editWork` is the store calls of the edit's transaction in the
// order of design 7.2 step 8; the service's own flow is T-5, this is only what
// the store and the unit of work must make safe. Both worlds run it: the real
// adapters over the stub driver (statements), and the in-memory world (locks,
// rollback, two transactions interleaved through the fake's round trips).

interface EditPlan {
  cycleId: number;
  timelineId: number;
  version: number;
  name?: string;
  allResultTypes?: boolean;
  steps: Array<{ position: number; closesOn: string }>;
  programIds?: number[];
  resultTypeKeys?: string[];
}

interface EditOptions {
  /** Re-read the row FOR UPDATE and compare the version, as the service does (default); false leaves the conditional UPDATE alone. */
  relock?: boolean;
  /** Called with the version `findForUpdate` returned, once the lock is held. */
  onLocked?: (version: number) => void;
}

const editWork =
  (plan: EditPlan, { relock = true, onLocked }: EditOptions = {}) =>
  async ({ timelines }: TimelinesRepositories) => {
    await timelines.lockCycleShared(plan.cycleId);
    if (relock) {
      const locked = await timelines.findForUpdate(plan.timelineId);
      if (!locked) throw new TimelineNotFoundError(plan.timelineId);
      onLocked?.(locked.version);
      if (locked.version !== plan.version) {
        throw new TimelineVersionStaleError();
      }
    }
    const outcome = await timelines.updateTimeline(
      plan.timelineId,
      plan.version,
      {
        name: plan.name,
        allResultTypes: plan.allResultTypes,
        updatedAt: FIXED,
        updatedBy: 9,
      },
    );
    if (outcome.kind === 'name_taken') throw new TimelineNameTakenError();
    if (outcome.kind === 'stale') throw new TimelineVersionStaleError();
    for (const step of plan.steps) {
      await timelines.updateStep(plan.timelineId, step.position, {
        closesOn: step.closesOn,
      });
    }
    if (plan.programIds) {
      await timelines.replacePrograms(plan.timelineId, plan.programIds);
    }
    if (plan.resultTypeKeys) {
      await timelines.replaceResultTypes(plan.timelineId, plan.resultTypeKeys);
    }
    await timelines.insertAuditEvent({
      timelineId: plan.timelineId,
      actorId: 9,
      action: 'update',
      changes: { name: { before: 'July 2026', after: plan.name ?? null } },
      requestId: 'req-1',
      createdAt: FIXED,
    });
    return 'updated' as const;
  };

describe('timeline edit over a stub MySQL driver (design 7.3, DD-6, DD-10, NFR-5)', () => {
  const plan: EditPlan = {
    cycleId: 3,
    timelineId: 11,
    version: 1,
    name: 'August 2026',
    allResultTypes: true,
    steps: [{ position: 2, closesOn: '2026-11-14' }],
    programIds: [2, 3],
    resultTypeKeys: [],
  };

  it('an edit: READ COMMITTED, the cycle FOR SHARE, the timeline FOR UPDATE, the conditional UPDATE, the step by position, the scope DELETE then INSERT, the audit INSERT, commit, all on the transaction connection', async () => {
    const { db, log } = stub();

    const result = await new DrizzleTimelinesUnitOfWork(db).run(editWork(plan));

    expect(result).toBe('updated');
    expect(log.slice(0, 2).map((s) => s.sql)).toEqual([
      'set transaction isolation level read committed',
      'begin',
    ]);
    const inTx = inTransaction(log);
    // Nothing of the edit, the audit row included, ran outside the transaction.
    expect(inTx.map((s) => s.via)).toEqual(inTx.map(() => 'tx'));
    expect(log.filter((s) => s.via === 'pool')).toEqual([]);
    expect(inTx[1]!.sql).toMatch(
      /from `cycles` where `cycles`\.`id` = \? limit \? for share$/,
    );
    expect(inTx[2]!.sql).toMatch(
      /from `timelines` where `timelines`\.`id` = \? limit \? for update$/,
    );
    expect(inTx[2]!.params[0]).toBe(11);
    // The version is in the WHERE of the UPDATE, and the UPDATE raises it by one.
    const update = inTx[3]!;
    expect(update.sql).toMatch(/^update `timelines` set /);
    expect(update.sql).toMatch(/`version` = .*`version` \+ 1/);
    expect(update.sql).toMatch(
      /where \(`timelines`\.`id` = \? and `timelines`\.`version` = \?\)$/,
    );
    expect(update.params.slice(-2)).toEqual([11, 1]);
    expect(update.params).toEqual(expect.arrayContaining(['August 2026', 9]));
    const assignments = update.sql.split(' where ')[0]!;
    expect(assignments).toContain('`name` = ?');
    expect(assignments).toContain('`all_result_types` = ?');
    expect(assignments).toContain('`updated_at` = ?');
    expect(assignments).toContain('`updated_by` = ?');
    // A field the edit did not send, and the fields no edit can change, are never written.
    expect(assignments).not.toMatch(
      /all_programs|`kind`|`cycle_id`|created_by|created_at/,
    );
    expect(inTx[4]!.sql).toBe(
      'update `timeline_steps` set `closes_on` = ? where (`timeline_steps`.`timeline_id` = ? and `timeline_steps`.`position` = ?)',
    );
    expect(inTx[4]!.params).toEqual(['2026-11-14', 11, 2]);
    expect(inTx[5]!.sql).toBe(
      'delete from `timeline_programs` where `timeline_programs`.`timeline_id` = ?',
    );
    expect(inTx[5]!.params).toEqual([11]);
    expect(inTx[6]!.sql).toMatch(/^insert into `timeline_programs`/);
    expect(inTx[6]!.params).toEqual([11, 2, 11, 3]);
    // An empty list (the "all" flag) is a DELETE and no INSERT.
    expect(inTx[7]!.sql).toBe(
      'delete from `timeline_result_types` where `timeline_result_types`.`timeline_id` = ?',
    );
    expect(insertsInto(log, 'timeline_result_types')).toEqual([]);
    expect(inTx[8]!.sql).toMatch(/^insert into `timeline_audit_events`/);
    expect(inTx[8]!.params).toEqual(
      expect.arrayContaining([11, 9, 'update', 'req-1']),
    );
    expect(inTx[8]!.params).toContain(
      JSON.stringify({ name: { before: 'July 2026', after: 'August 2026' } }),
    );
    expect(inTx.at(-1)!.sql).toBe('commit');
    expect(inTx).toHaveLength(10);
  });

  it('the conditional UPDATE answers by its affected rows alone: 1 is updated, 0 is stale, and no read runs before it', async () => {
    for (const [rows, kind] of [
      [1, 'updated'],
      [0, 'stale'],
    ] as const) {
      const { db, log } = stub({ timelineUpdateRows: rows });

      const outcome = await new DrizzleTimelinesUnitOfWork(db).run(
        ({ timelines }) =>
          timelines.updateTimeline(11, 1, { updatedAt: FIXED, updatedBy: 9 }),
      );

      expect(outcome).toEqual({ kind });
      expect(inTransaction(log).map((s) => s.sql.split(' ')[0])).toEqual([
        'begin',
        'update',
        'commit',
      ]);
    }
  });

  it('a duplicate name (1062 on `uq_timelines_cycle_name`) on update is name_taken: rolled back, no step, scope or audit statement, no commit', async () => {
    const { db, log } = stub({
      timelineUpdateError: duplicate('timelines.uq_timelines_cycle_name'),
    });

    await expect(
      new DrizzleTimelinesUnitOfWork(db).run(editWork(plan)),
    ).rejects.toBeInstanceOf(TimelineNameTakenError);

    const sqls = log.map((s) => s.sql);
    expect(sqls.at(-1)).toBe('rollback');
    expect(sqls).not.toContain('commit');
    expect(sqls.filter((s) => s.startsWith('update `timeline_steps`'))).toEqual(
      [],
    );
    expect(sqls.filter((s) => s.startsWith('delete from'))).toEqual([]);
    expect(insertsInto(log, 'timeline_audit_events')).toEqual([]);
  });

  it('a duplicate key wrapped as the cause of another error is still name_taken; a 1062 on another key is thrown and rolled back', async () => {
    const wrapped = Object.assign(new Error('Failed query'), {
      cause: duplicate('timelines.uq_timelines_cycle_name'),
    });
    const named = stub({ timelineUpdateError: wrapped });
    await expect(
      new DrizzleTimelinesUnitOfWork(named.db).run(editWork(plan)),
    ).rejects.toBeInstanceOf(TimelineNameTakenError);

    const other = stub({
      timelineUpdateError: duplicate('timelines.uq_timelines_official_key'),
    });
    // drizzle wraps the driver error: the 1062 on the other key is its `cause`.
    const refused: unknown = await new DrizzleTimelinesUnitOfWork(other.db)
      .run(editWork(plan))
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(Error);
    expect(refused).not.toBeInstanceOf(TimelineNameTakenError);
    expect(
      (refused as { cause?: { sqlMessage?: string } }).cause?.sqlMessage,
    ).toContain('uq_timelines_official_key');
    expect(other.log.at(-1)!.sql).toBe('rollback');
  });

  it('findBundle is four statements on the pool, the row first, then steps, programs and result types, and maps the rows', async () => {
    const { db, log } = stub();

    const bundle = await new DrizzleTimelinesStore(db).findBundle(11);

    expect(log.map((s) => [s.via, /from `(\w+)`/.exec(s.sql)![1]])).toEqual([
      ['pool', 'timelines'],
      ['pool', 'timeline_steps'],
      ['pool', 'timeline_programs'],
      ['pool', 'timeline_result_types'],
    ]);
    expect(bundle).toMatchObject({
      timeline: { id: 11, version: 1 },
      programIds: [2],
      resultTypeKeys: ['KP'],
    });
    expect(bundle!.steps).toHaveLength(1);
  });

  it('the statements of an edit do not depend on how many steps the timeline has: each CHANGED step adds one UPDATE and nothing else grows', async () => {
    const total = async (stepCount: number, changed: number[]) => {
      const { db, log } = stub({ stepCount });
      await new DrizzleTimelinesStore(db).findBundle(11);
      await new DrizzleTimelinesUnitOfWork(db).run(
        editWork({
          ...plan,
          version: 1,
          steps: changed.map((position) => ({
            position,
            closesOn: '2026-11-14',
          })),
        }),
      );
      return {
        statements: log.length,
        stepUpdates: log.filter((s) =>
          s.sql.startsWith('update `timeline_steps`'),
        ).length,
      };
    };

    const one = await total(1, [1]);
    const five = await total(5, [1]);
    const allFive = await total(5, [1, 2, 3, 4, 5]);

    // 4 reads of the bundle + set isolation, begin, cycle, timeline, update,
    // 1 step, 2 program statements, 1 result-type DELETE, audit, commit.
    expect(one).toEqual({ statements: 15, stepUpdates: 1 });
    expect(five).toEqual(one);
    expect(allFive).toEqual({ statements: 19, stepUpdates: 5 });
  });
});

describe('timeline edit over the in-memory world (FR-9, FR-10, NFR-3, NFR-5; the fake interleaves at every statement)', () => {
  const plan: EditPlan = {
    cycleId: 1,
    timelineId: 11,
    version: 4,
    name: 'September 2026',
    steps: [{ position: 2, closesOn: '2026-12-01' }],
    programIds: [2, 3],
    resultTypeKeys: [],
  };

  /** One cycle, the official timeline 11 at version 4 (steps, program 2, result type KP) and the additional 12 named August 2026. */
  function seed(stepCount = 3) {
    const db = new InMemoryAdminConfigDatabase();
    const created = new Date('2026-10-01T09:00:00.000Z');
    db.cycles.push({
      id: 1,
      year: 2026,
      status: 'active',
      activeKey: 1,
      createdAt: created,
      createdBy: 1,
      activatedAt: created,
      activatedBy: 1,
      closedAt: null,
      closedBy: null,
    });
    const timeline = {
      cycleId: 1,
      allPrograms: false,
      allResultTypes: false,
      createdAt: created,
      createdBy: 1,
      updatedAt: null,
      updatedBy: null,
    };
    db.timelines.push(
      {
        ...timeline,
        id: 11,
        name: 'July 2026',
        kind: 'official',
        officialKey: 1,
        version: 4,
      },
      {
        ...timeline,
        id: 12,
        name: 'August 2026',
        kind: 'additional',
        officialKey: null,
        version: 1,
      },
    );
    const audiences = [
      'assessors',
      'programs',
      'lead_assessors',
      'tpb',
      'ppu',
    ] as const;
    for (let position = 1; position <= stepCount; position++) {
      const opens = position * 3;
      db.steps.push({
        id: position,
        timelineId: 11,
        position,
        name: `Step ${position}`,
        audience: audiences[position - 1]!,
        opensOn: `2026-11-${String(opens).padStart(2, '0')}`,
        closesOn: `2026-11-${String(opens + 2).padStart(2, '0')}`,
        round: 1,
        requiresLoad: position === 1,
      });
    }
    db.programs.push({ timelineId: 11, programId: 2 });
    db.resultTypes.push({ timelineId: 11, resultTypeKey: 'KP' });
    return { db, uow: new InMemoryTimelinesUnitOfWork(db) };
  }

  const committed = (db: InMemoryAdminConfigDatabase) =>
    structuredClone({
      timelines: db.timelines,
      steps: db.steps,
      programs: db.programs,
      resultTypes: db.resultTypes,
      audit: db.auditEvents,
    });

  it('an applied edit commits the version, the step, the scope and exactly one audit row together', async () => {
    const { db, uow } = seed();

    await uow.run(editWork(plan));

    expect(db.timelines.find((t) => t.id === 11)).toMatchObject({
      name: 'September 2026',
      version: 5,
      updatedAt: FIXED,
      updatedBy: 9,
    });
    const step = (position: number) =>
      db.steps.find((s) => s.timelineId === 11 && s.position === position)!;
    expect(step(2).closesOn).toBe('2026-12-01');
    expect(step(1).closesOn).toBe('2026-11-05');
    expect(
      db.programs.filter((p) => p.timelineId === 11).map((p) => p.programId),
    ).toEqual([2, 3]);
    expect(db.resultTypes.filter((r) => r.timelineId === 11)).toEqual([]);
    expect(db.auditEvents).toEqual([
      expect.objectContaining({
        timelineId: 11,
        actorId: 9,
        action: 'update',
        requestId: 'req-1',
        createdAt: FIXED,
      }),
    ]);
    // The other timeline is untouched.
    expect(db.timelines.find((t) => t.id === 12)).toMatchObject({
      name: 'August 2026',
      version: 1,
    });
  });

  it('a rollback after every write leaves no timeline, step, scope or audit change', async () => {
    const { db, uow } = seed();
    const before = committed(db);

    await expect(
      uow.run(async (repositories) => {
        await editWork(plan)(repositories);
        throw new Error('the answer was lost');
      }),
    ).rejects.toThrow('the answer was lost');

    // Every write really ran (the log keeps rolled-back statements) ...
    expect(db.timelineWriteLog).toEqual([
      'timeline:update:11',
      'step:update:11:2',
      'programs:delete:11',
      'programs:11',
      'result-types:delete:11',
      'audit:11',
    ]);
    // ... and none of it is committed, the audit row included.
    expect(committed(db)).toEqual(before);
    expect(db.auditEvents).toHaveLength(0);
    expect([uow.committed, uow.rolledBack]).toEqual([0, 1]);
  });

  it('a rename into a taken name, in any letter case, is name_taken: the transaction rolls back and nothing else is written', async () => {
    const { db, uow } = seed();
    const before = committed(db);

    await expect(
      uow.run(editWork({ ...plan, name: 'AUGUST 2026' })),
    ).rejects.toBeInstanceOf(TimelineNameTakenError);

    expect(committed(db)).toEqual(before);
    expect(db.nameViolations).toBe(1);
    expect(db.timelineWriteLog).toEqual([]);
    expect([uow.committed, uow.rolledBack]).toEqual([0, 1]);
  });

  it('two edits on the same version run at once: one is updated, the other waits for the first commit, then finds the version moved and is stale', async () => {
    const { db } = seed();
    const first = new InMemoryTimelinesUnitOfWork(db);
    const second = new InMemoryTimelinesUnitOfWork(db);
    const commits = () => first.committed + second.committed;
    const events: string[] = [];
    const edit = (
      who: string,
      name: string,
    ): ((r: TimelinesRepositories) => Promise<'updated'>) => {
      return (repositories) => {
        events.push(`${who} requested after ${commits()} commits`);
        return editWork(
          { ...plan, name },
          {
            onLocked: (version) =>
              events.push(
                `${who} locked v${version} after ${commits()} commits`,
              ),
          },
        )(repositories);
      };
    };

    const settled = await Promise.allSettled([
      first.run(edit('Ana', 'Ana 2026')),
      second.run(edit('Luis', 'Luis 2026')),
    ]);

    // Luis asked while Ana was in flight, and got the row only after her commit.
    expect(events).toEqual([
      'Ana requested after 0 commits',
      'Luis requested after 0 commits',
      'Ana locked v4 after 0 commits',
      'Luis locked v5 after 1 commits',
    ]);
    expect(settled[0]).toEqual({ status: 'fulfilled', value: 'updated' });
    expect(settled[1]).toMatchObject({
      status: 'rejected',
      reason: expect.any(TimelineVersionStaleError),
    });
    // Ana's edit is not merged into or overwritten by Luis's; one version, one audit row.
    expect(db.timelines.find((t) => t.id === 11)).toMatchObject({
      name: 'Ana 2026',
      version: 5,
    });
    expect(db.auditEvents).toHaveLength(1);
    expect([second.committed, second.rolledBack]).toEqual([0, 1]);
  });

  it('the conditional UPDATE alone refuses the second of two same-version writes: the version is checked under the row lock, which is held until the commit', async () => {
    const { db } = seed();
    // No FOR UPDATE read first. The audit INSERT after the UPDATE keeps the
    // transaction open for another statement, as a real edit does, so the
    // second UPDATE arrives while the first is still uncommitted.
    const write = (name: string) => async (r: TimelinesRepositories) => {
      const outcome = await r.timelines.updateTimeline(11, 4, {
        name,
        updatedAt: FIXED,
        updatedBy: 9,
      });
      if (outcome.kind === 'updated') {
        await r.timelines.insertAuditEvent({
          timelineId: 11,
          actorId: 9,
          action: 'update',
          changes: { name: { before: 'July 2026', after: name } },
          requestId: 'req-1',
          createdAt: FIXED,
        });
      }
      return outcome;
    };

    const outcomes = await Promise.all([
      new InMemoryTimelinesUnitOfWork(db).run(write('Ana 2026')),
      new InMemoryTimelinesUnitOfWork(db).run(write('Luis 2026')),
    ]);

    expect(outcomes.map((o) => o.kind).sort()).toEqual(['stale', 'updated']);
    const winner = outcomes[0]!.kind === 'updated' ? 'Ana 2026' : 'Luis 2026';
    expect(db.timelines.find((t) => t.id === 11)).toMatchObject({
      name: winner,
      version: 5,
    });
    expect(db.auditEvents).toHaveLength(1);
  });

  it('a rename racing a create of the same name: the create waits on the name entry until the rename commits, then the name key refuses it, so exactly one timeline holds the name', async () => {
    const { db } = seed();
    const rename = new InMemoryTimelinesUnitOfWork(db);
    const create = new InMemoryTimelinesUnitOfWork(db);
    const events: string[] = [];
    // Both transactions stay open after their first write (the audit INSERT of
    // an edit, the steps INSERT of a create), as a real edit and a real create
    // do. A transaction that ran one statement would commit before its rival's
    // first statement started (a round trip is one `setImmediate`), and the
    // name entry would never be contended.
    const renamed = rename.run(async ({ timelines }) => {
      const outcome = await timelines.updateTimeline(11, 4, {
        name: 'Race 2026',
        updatedAt: FIXED,
        updatedBy: 9,
      });
      events.push(`rename ${outcome.kind}`);
      await timelines.insertAuditEvent({
        timelineId: 11,
        actorId: 9,
        action: 'update',
        changes: { name: { before: 'July 2026', after: 'Race 2026' } },
        requestId: 'req-1',
        createdAt: FIXED,
      });
      events.push('rename audited');
      return outcome;
    });
    const created = create.run(async ({ timelines }) => {
      const outcome = await timelines.insert({
        cycleId: 1,
        name: 'race 2026',
        kind: 'additional',
        allPrograms: true,
        allResultTypes: true,
        createdBy: 9,
      });
      events.push(
        `create ${outcome.kind} after ${rename.committed} rename commits`,
      );
      if (outcome.kind === 'name_taken') throw new TimelineNameTakenError();
      if (outcome.kind !== 'created') throw new Error(outcome.kind);
      await timelines.insertSteps(outcome.timelineId, [
        {
          position: 1,
          name: 'Step 1',
          audience: 'assessors',
          opensOn: '2026-11-03',
          closesOn: '2026-11-05',
          round: 1,
          requiresLoad: true,
        },
      ]);
      events.push('create wrote its steps');
      return outcome;
    });

    const settled = await Promise.allSettled([renamed, created]);

    // NFR-3: one timeline holds the name (the rename's), never two.
    expect(
      db.timelines
        .filter((t) => collateName(t.name) === 'race 2026')
        .map((t) => t.name),
    ).toEqual(['Race 2026']);
    // The rename asked first and took the name entry. The create's INSERT sat
    // on that entry past the rename's audit INSERT, answered only after the
    // rename's commit, and found the name taken.
    expect(events).toEqual([
      'rename updated',
      'rename audited',
      'create name_taken after 1 rename commits',
    ]);
    expect(settled[0]).toEqual({
      status: 'fulfilled',
      value: { kind: 'updated' },
    });
    expect(settled[1]).toMatchObject({
      status: 'rejected',
      reason: expect.any(TimelineNameTakenError),
    });
    expect(db.timelines.find((t) => t.id === 11)).toMatchObject({
      name: 'Race 2026',
      version: 5,
    });
    // The refused create wrote nothing: no steps for a new timeline, one audit row.
    expect(db.steps.filter((s) => s.timelineId !== 11)).toEqual([]);
    expect(db.auditEvents).toHaveLength(1);
    expect(db.nameViolations).toBe(1);
    expect([
      rename.committed,
      rename.rolledBack,
      create.committed,
      create.rolledBack,
    ]).toEqual([1, 0, 0, 1]);
  });

  it('the edit runs the same statements on a timeline of one step and on one of five', async () => {
    const counts: Array<[number, number]> = [];
    for (const stepCount of [1, 5]) {
      const { db, uow } = seed(stepCount);
      await uow.run(
        editWork({ ...plan, steps: [{ position: 1, closesOn: '2026-12-01' }] }),
      );
      counts.push([db.timelineReadLog.length, db.timelineWriteLog.length]);
    }

    // Reads: the cycle FOR SHARE and the timeline FOR UPDATE. Writes: the
    // timeline, one step, both scope tables, the audit row.
    expect(counts).toEqual([
      [2, 6],
      [2, 6],
    ]);
  });
});
