// @akili-spec admin-config/cycle-timelines
import { drizzle } from 'drizzle-orm/mysql2';
import { IdempotencyFenceLostError } from '../../common/idempotency/idempotency.errors.js';
import * as schema from '../../database/drizzle/schema/index.js';
import { CatalogService } from '../../users/catalogs/catalog.service.js';
import { UpstreamUnavailableError } from '../../users/catalogs/catalogs.errors.js';
import type { AdminConfigContext } from '../admin-config.context.js';
import { TimelineNameTakenError } from '../admin-config.errors.js';
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
}

function stub({
  official = false,
  fenceRows = 1,
  failInsert,
  catalogDown,
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
      if (sql.startsWith('insert')) {
        return Promise.resolve([{ insertId: 0, affectedRows: 1 }, []]);
      }
      if (!sql.startsWith('select')) {
        const affectedRows = sql.startsWith('update `idempotency_keys`')
          ? fenceRows
          : 1;
        return Promise.resolve([{ affectedRows }, []]);
      }
      let rows: unknown[][];
      if (sql.includes('from `cycles`')) rows = [draftCycle];
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
      else rows = [[11, 3, 'July 2026', 'official', 3, 0, 0, at, 1]];
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
