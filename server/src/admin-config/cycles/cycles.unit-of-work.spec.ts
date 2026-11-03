// @akili-spec admin-config/cycle-timelines
import { drizzle } from 'drizzle-orm/mysql2';
import { IdempotencyFenceLostError } from '../../common/idempotency/idempotency.errors.js';
import * as schema from '../../database/drizzle/schema/index.js';
import type { AdminConfigContext } from '../admin-config.context.js';
import { CyclesService } from './cycles.service.js';
import { DrizzleCyclesStore } from './cycles.store.js';
import { DrizzleCyclesUnitOfWork } from './cycles.unit-of-work.js';

// The real adapters over a stub MySQL driver: statements are asserted, as
// there is no disposable MySQL (the shared qadb is never touched). Expected
// values are design 7.3 / 7.4 written out: READ COMMITTED, the target row then
// the active row FOR UPDATE, close before activate, the mark inside the
// transaction, and ONE grouped statement for the list.

const at = '2026-10-19 10:00:00';
const FIXED = new Date('2026-10-20T10:00:00.000Z');

interface Statement {
  via: 'pool' | 'tx';
  sql: string;
  params: unknown[];
}

// `cycles` columns in table order: id, year, status, active_key, created_at,
// created_by, activated_at, activated_by, closed_at, closed_by.
const draftRow = [3, 2027, 'draft', null, at, 1, null, null, null, null];
const activeRow = [2, 2026, 'active', 1, at, 1, at, 1, null, null];
const summaryRow = [3, 2027, 'draft', at, 0, null, null];

function stub(fenceRows = 1, summary: unknown[] = summaryRow) {
  const log: Statement[] = [];
  const answer = (via: Statement['via']) => ({
    query: ({ sql }: { sql: string }, values?: unknown[]) => {
      log.push({ via, sql, params: values ?? [] });
      if (sql.startsWith('insert')) {
        return Promise.resolve([{ insertId: 3, affectedRows: 1 }, []]);
      }
      if (!sql.startsWith('select')) {
        const affectedRows = sql.startsWith('update `idempotency_keys`')
          ? fenceRows
          : 1;
        return Promise.resolve([{ affectedRows }, []]);
      }
      const row = sql.includes('group by')
        ? summary
        : sql.includes('`active_key` = ?')
          ? activeRow
          : draftRow;
      return Promise.resolve([[row], []]);
    },
  });
  // A pool, as in production: a transaction takes one connection from it.
  const pool = {
    ...answer('pool'),
    getConnection: async () => ({ ...answer('tx'), release: () => {} }),
  };
  const db = drizzle({ client: pool as never, schema, mode: 'default' });
  const service = new CyclesService(
    new DrizzleCyclesUnitOfWork(db),
    new DrizzleCyclesStore(db),
    () => FIXED,
  );
  return { service, log };
}

const ctx: AdminConfigContext = { actorId: 9, requestId: 'req-1' };
const keyedCtx: AdminConfigContext = {
  ...ctx,
  idempotency: {
    reservation: { actorId: 9, key: 'k-1', ownerToken: 'token-1' },
    outcome: 'none',
  },
};

describe('DrizzleCyclesUnitOfWork over a stub MySQL driver', () => {
  it('activation: READ COMMITTED, the target row then the active row FOR UPDATE, close, activate, commit, all on the transaction connection', async () => {
    const { service, log } = stub();

    await service.activate(ctx, 3);

    const inTx = log.slice(
      log.findIndex((s) => s.sql === 'begin'),
      log.findIndex((s) => s.sql === 'commit') + 1,
    );
    expect(log.slice(0, 2).map((s) => s.sql)).toEqual([
      'set transaction isolation level read committed',
      'begin',
    ]);
    expect(inTx.map((s) => s.via)).toEqual(inTx.map(() => 'tx'));
    expect(inTx[1]!.sql).toMatch(
      /from `cycles` where `cycles`\.`id` = \? limit \? for update$/,
    );
    expect(inTx[2]!.sql).toMatch(
      /from `cycles` where `cycles`\.`active_key` = \? limit \? for update$/,
    );
    expect(inTx[3]!.sql).toBe(
      'update `cycles` set `status` = ?, `closed_at` = ?, `closed_by` = ? where `cycles`.`id` = ?',
    );
    expect([inTx[3]!.params[0], inTx[3]!.params.at(-1)]).toEqual(['closed', 2]);
    expect(inTx[4]!.sql).toBe(
      'update `cycles` set `status` = ?, `activated_at` = ?, `activated_by` = ? where `cycles`.`id` = ?',
    );
    expect([inTx[4]!.params[0], inTx[4]!.params.at(-1)]).toEqual(['active', 3]);
    expect(inTx.at(-1)!.sql).toBe('commit');
    expect(inTx).toHaveLength(6);
  });

  it('a keyed create writes the cycle and marks the key inside the transaction, then commits', async () => {
    const { service, log } = stub();

    await service.create(keyedCtx, { year: 2027 });

    const sqls = log.map((s) => s.sql);
    const insert = sqls.findIndex((s) => s.startsWith('insert into `cycles`'));
    const mark = sqls.findIndex((s) =>
      s.startsWith('update `idempotency_keys`'),
    );
    expect(insert).toBeGreaterThan(sqls.indexOf('begin'));
    expect(mark).toBeGreaterThan(insert);
    expect(sqls.indexOf('commit')).toBeGreaterThan(mark);
    expect(log[insert]!.via).toBe('tx');
    expect(log[mark]!.via).toBe('tx');
    // The mark is conditioned on the state and the owner token (FR-17).
    expect(log[mark]!.sql).toMatch(
      /`state` = \? and `idempotency_keys`\.`owner_token` = \?/,
    );
  });

  it('an unkeyed create marks nothing', async () => {
    const { service, log } = stub();

    await service.create(ctx, { year: 2027 });

    expect(log.some((s) => s.sql.includes('idempotency_keys'))).toBe(false);
  });

  it('a lost fence (the mark matches no row) rolls the transaction back, with no commit', async () => {
    const { service, log } = stub(0);

    await expect(
      service.create(keyedCtx, { year: 2027 }),
    ).rejects.toBeInstanceOf(IdempotencyFenceLostError);

    const sqls = log.map((s) => s.sql);
    expect(sqls).toContain('rollback');
    expect(sqls).not.toContain('commit');
  });

  it('the list is ONE grouped statement on the pool: counts, min and max over left joins, newest year first', async () => {
    const { service, log } = stub();

    const list = await service.list();

    expect(log).toHaveLength(1);
    expect(log[0]!.via).toBe('pool');
    const sql = log[0]!.sql;
    expect(sql).toMatch(/count\(distinct `timelines`\.`id`\)/);
    expect(sql).toMatch(/min\(`timeline_steps`\.`opens_at`\)/);
    expect(sql).toMatch(/max\(`timeline_steps`\.`closes_at`\)/);
    expect(sql).toMatch(
      /from `cycles` left join `timelines` on `timelines`\.`cycle_id` = `cycles`\.`id` left join `timeline_steps` on `timeline_steps`\.`timeline_id` = `timelines`\.`id`/,
    );
    expect(sql).toMatch(/group by `cycles`\.`id`/);
    expect(sql).toMatch(/order by `cycles`\.`year` desc$/);
    expect(list).toEqual([
      {
        id: 3,
        year: 2027,
        name: '2027 cycle',
        status: 'draft',
        timelineCount: 0,
        startsOn: null,
        endsOn: null,
        createdAt: new Date('2026-10-19T10:00:00.000Z'),
      },
    ]);
  });
  it('the span stays in days: the DATETIME min and max come back as YYYY-MM-DD (timeline-step-times FR-13, DD-9)', async () => {
    // What mysql2 hands over for a DATETIME in string mode (P-2): the date and the time.
    const { service } = stub(1, [
      3,
      2027,
      'draft',
      at,
      2,
      '2026-11-02 00:00:00',
      '2026-12-31 23:59:00',
    ]);

    const [cycle] = await service.list();

    expect([cycle!.startsOn, cycle!.endsOn]).toEqual([
      '2026-11-02',
      '2026-12-31',
    ]);
  });
});
