// @akili-spec assessment/step-1-assessment
import { Logger, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { drizzle } from 'drizzle-orm/mysql2';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DRIZZLE, MYSQL_POOL } from '../database/drizzle/drizzle.constants.js';
import type { DrizzleDB } from '../database/drizzle/drizzle.module.js';
import {
  SNAPSHOT_STORE,
  type ResultSnapshotRecord,
  type SnapshotStore,
} from '../ingestion/snapshot-store.port.js';
import {
  emptyTitleBackfillStore,
  withoutTitleBackfill,
} from '../../test/support/without-title-backfill.js';
import { AssessmentModule } from './assessment.module.js';
import {
  DrizzleTitleBackfillStore,
  TITLE_BACKFILL_PAGE_SIZE,
  TITLE_BACKFILL_STORE,
  TitleBackfill,
  type TitleBackfillStore,
  type UntitledMembership,
} from './title-backfill.js';

// Title backfill (FR-24, design 7.8, DD-9). The relational side is a fake whose
// conditional update READS the statement of the real adapter: it applies the
// `title IS NULL` guard only when the generated SQL carries it, so dropping the
// clause from the code turns the "titled meanwhile" test red, not only the SQL
// test. The snapshot store is a fake with a call log and an optional gate.

const ROWS = 120;

interface Row extends UntitledMembership {
  title: string | null;
}

const realStore = new DrizzleTitleBackfillStore(
  drizzle.mock() as unknown as DrizzleDB,
);

class FakeMembershipStore implements TitleBackfillStore {
  readonly rows: Row[] = [];
  readonly pageCalls: Array<{ afterId: number; limit: number }> = [];
  updatesApplied = 0;

  constructor(count: number) {
    for (let id = 1; id <= count; id++) {
      this.rows.push({
        id,
        resultCode: 1000 + id,
        snapshotSk: `SNAP#2026#000001#00000001#${String(id).padStart(10, '0')}`,
        title: null,
      });
    }
  }

  untitledAfter(afterId: number, limit: number) {
    this.pageCalls.push({ afterId, limit });
    return Promise.resolve(
      this.rows
        .filter((r) => r.title === null && r.id > afterId)
        .sort((a, b) => a.id - b.id)
        .slice(0, limit)
        .map(({ id, resultCode, snapshotSk }) => ({
          id,
          resultCode,
          snapshotSk,
        })),
    );
  }

  setTitleIfNull(id: number, title: string) {
    // The guard exists only if the real adapter's statement says so.
    const { sql } = realStore.buildUpdate(id, title).toSQL();
    const guarded = sql.includes('`title` is null');
    const row = this.rows.find((r) => r.id === id);
    if (!row || (guarded && row.title !== null)) return Promise.resolve(false);
    row.title = title;
    this.updatesApplied++;
    return Promise.resolve(true);
  }
}

class FakeSnapshots {
  readonly gets: Array<{ resultCode: number; sk: string }> = [];
  readonly missing = new Set<number>();
  /** Runs while a read is in flight, to model another writer. */
  onGet: ((resultCode: number) => Promise<void> | void) | null = null;

  get(resultCode: number, sk: string) {
    this.gets.push({ resultCode, sk });
    return (async () => {
      await this.onGet?.(resultCode);
      if (this.missing.has(resultCode)) return null;
      return {
        resultCode,
        values: { 'general.title': `Title of ${resultCode}` },
      } as unknown as ResultSnapshotRecord;
    })();
  }
}

function build(count = ROWS) {
  const store = new FakeMembershipStore(count);
  const snapshots = new FakeSnapshots();
  const backfill = new TitleBackfill(
    store,
    snapshots as unknown as SnapshotStore,
  );
  return { store, snapshots, backfill };
}

afterEach(() => vi.restoreAllMocks());

describe('TitleBackfill (FR-24, DD-9)', () => {
  it('uses a fixture larger than one page, or the paging would never be exercised', () => {
    expect(TITLE_BACKFILL_PAGE_SIZE).toBe(50);
    expect(ROWS).toBeGreaterThan(TITLE_BACKFILL_PAGE_SIZE);
  });

  it('titles all 120 untitled rows over 3 pages of 50, reading each snapshot by the part of its key after the prefix', async () => {
    const { store, snapshots, backfill } = build();

    const result = await backfill.run();

    expect(result).toEqual({ scanned: 120, titled: 120, missing: 0 });
    expect(
      store.rows.every((r) => r.title === `Title of ${r.resultCode}`),
    ).toBe(true);
    expect(store.pageCalls).toEqual([
      { afterId: 0, limit: 50 },
      { afterId: 50, limit: 50 },
      { afterId: 100, limit: 50 },
    ]);
    expect(snapshots.gets).toHaveLength(120);
    expect(snapshots.gets[0]).toEqual({
      resultCode: 1001,
      sk: '2026#000001#00000001#0000000001',
    });
  });

  it('cuts the title the way the load does (1,000 code points) and leaves a non-string title null', async () => {
    const { store, snapshots, backfill } = build(3);
    const values: Record<number, unknown> = {
      1001: '😀'.repeat(1001),
      1002: 42,
      1003: 'short',
    };
    snapshots.get = (resultCode: number) =>
      Promise.resolve({
        resultCode,
        values: { 'general.title': values[resultCode] },
      } as unknown as ResultSnapshotRecord);

    const result = await backfill.run();

    expect(Array.from(store.rows[0].title ?? '')).toHaveLength(1000);
    expect(store.rows[1].title).toBeNull();
    expect(store.rows[2].title).toBe('short');
    expect(result).toEqual({ scanned: 3, titled: 2, missing: 1 });
  });

  it('touches 0 rows on a second run', async () => {
    const { store, backfill } = build();
    await backfill.run();
    const applied = store.updatesApplied;
    store.pageCalls.length = 0;

    const second = await backfill.run();

    expect(second).toEqual({ scanned: 0, titled: 0, missing: 0 });
    expect(store.updatesApplied).toBe(applied);
    expect(store.pageCalls).toEqual([{ afterId: 0, limit: 50 }]);
  });

  it('leaves null where the snapshot is missing and continues with the rest', async () => {
    const { store, snapshots, backfill } = build();
    snapshots.missing.add(1007).add(1060);

    const result = await backfill.run();

    expect(result).toEqual({ scanned: 120, titled: 118, missing: 2 });
    expect(store.rows[6].title).toBeNull();
    expect(store.rows[59].title).toBeNull();
    expect(store.rows[119].title).toBe('Title of 1120');
  });

  it('does not overwrite a title written while its snapshot was being read (deferred fixture)', async () => {
    const { store, snapshots, backfill } = build();
    snapshots.onGet = async (resultCode) => {
      // Row 77 is titled by someone else after the page was read.
      if (resultCode === 1077) store.rows[76].title = 'Written meanwhile';
      await Promise.resolve();
    };

    const result = await backfill.run();

    expect(store.rows[76].title).toBe('Written meanwhile');
    expect(result.titled).toBe(119);
  });

  it('returns from the bootstrap hook before the work ends', async () => {
    const { store, snapshots, backfill } = build();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    snapshots.onGet = () => gate;
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    const returned = backfill.onApplicationBootstrap();

    expect(returned).toBeUndefined();
    // The hook is back, and not one row has been titled yet.
    expect(store.updatesApplied).toBe(0);
    release();
    await backfill.whenDone();
    expect(store.updatesApplied).toBe(120);
  });

  it.each([
    ['inside a page, after the row in hand', 1005, 5],
    ['at the end of a page, before the next page is read', 1050, 50],
  ])(
    'stops %s when shutdown is requested mid-run, and shutdown resolves only after the run ended',
    async (_where, stopAt, scanned) => {
      const { store, snapshots, backfill } = build();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      snapshots.onGet = (resultCode) =>
        resultCode === stopAt ? gate : undefined;
      vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      backfill.onApplicationBootstrap();
      await vi.waitFor(() => expect(snapshots.gets).toHaveLength(scanned));

      // The read of row `scanned` is in flight; the stop is asked now.
      const shutdown = backfill.beforeApplicationShutdown();
      let resolved = false;
      void shutdown.then(() => (resolved = true));
      await Promise.resolve();
      expect(resolved).toBe(false);
      release();
      await expect(shutdown).resolves.toBeUndefined();

      // The row in hand was finished; no row and no page after it was started.
      expect(snapshots.gets).toHaveLength(scanned);
      expect(store.updatesApplied).toBe(scanned);
      expect(store.pageCalls).toEqual([{ afterId: 0, limit: 50 }]);
      expect(store.rows.filter((r) => r.title === null)).toHaveLength(
        ROWS - scanned,
      );
    },
  );

  it('shutdown resolves at once when no run was started', async () => {
    const { backfill } = build(3);

    await expect(backfill.beforeApplicationShutdown()).resolves.toBeUndefined();
  });

  it('logs a failure and never throws it into the bootstrap, carrying no title text', async () => {
    const { store, backfill } = build(3);
    const lines: string[] = [];
    vi.spyOn(Logger.prototype, 'error').mockImplementation((...args) => {
      lines.push(JSON.stringify(args));
    });
    vi.spyOn(Logger.prototype, 'log').mockImplementation((...args) => {
      lines.push(JSON.stringify(args));
    });
    store.untitledAfter = () =>
      Promise.reject(new Error('connect ECONNREFUSED secret-host Some Title'));

    expect(() => backfill.onApplicationBootstrap()).not.toThrow();
    await expect(backfill.whenDone()).resolves.toBeUndefined();

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('assessment_title_backfill');
    expect(lines[0]).not.toContain('secret-host');
    expect(lines[0]).not.toContain('Some Title');
  });

  it('logs counts only after a successful run', async () => {
    const { backfill } = build(3);
    const lines: string[] = [];
    vi.spyOn(Logger.prototype, 'log').mockImplementation((...args) => {
      lines.push(JSON.stringify(args));
    });

    backfill.onApplicationBootstrap();
    await backfill.whenDone();

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"scanned":3');
    expect(lines[0]).toContain('"titled":3');
    expect(lines[0]).not.toContain('Title of');
  });
});

describe('DrizzleTitleBackfillStore statements (DD-9)', () => {
  it('updates one row by id and only while its title is still null', () => {
    const { sql, params } = realStore.buildUpdate(7, 'A title').toSQL();

    expect(sql).toContain('update `timeline_results` set `title` = ?');
    expect(sql).toContain('`timeline_results`.`id` = ?');
    expect(sql).toContain('`timeline_results`.`title` is null');
    expect(sql).toContain(' and ');
    expect(params).toEqual(['A title', 7]);
  });

  it('reads untitled rows after a cursor, in id order, one page at a time', () => {
    const { sql, params } = realStore.buildPage(40, 50).toSQL();

    expect(sql).toContain('`timeline_results`.`title` is null');
    expect(sql).toContain('`timeline_results`.`id` > ?');
    expect(sql).toContain('order by `timeline_results`.`id`');
    expect(sql).toContain('limit ?');
    expect(params).toEqual([40, 50]);
  });
});

describe('withoutTitleBackfill (the e2e override of the backfill store)', () => {
  it('replaces the store the AssessmentModule registers, so no app that loads it queries the database', async () => {
    const moduleRef = await withoutTitleBackfill(
      Test.createTestingModule({ imports: [AssessmentModule] }),
    )
      .overrideProvider(MYSQL_POOL)
      .useValue({ end: async () => undefined })
      .overrideProvider(DRIZZLE)
      .useValue({})
      .compile();

    const own = moduleRef.select(AssessmentModule);
    expect(own.get(TITLE_BACKFILL_STORE, { strict: true })).toBe(
      emptyTitleBackfillStore,
    );
    expect(own.get(TitleBackfill, { strict: true })).toBeInstanceOf(
      TitleBackfill,
    );
    await moduleRef.close();
  });

  it('lets the started backfill end on one empty page: no snapshot read, no error, counts of 0', async () => {
    // The real store would refuse the connection; this one proves it is not used.
    const refusing: TitleBackfillStore = {
      untitledAfter: () => Promise.reject(new Error('connect ECONNREFUSED')),
      setTitleIfNull: () => Promise.reject(new Error('connect ECONNREFUSED')),
    };
    const snapshots = new FakeSnapshots();
    @Module({
      providers: [
        { provide: TITLE_BACKFILL_STORE, useValue: refusing },
        { provide: SNAPSHOT_STORE, useValue: snapshots },
        TitleBackfill,
      ],
    })
    class ProbeModule {}
    const errors: string[] = [];
    const lines: string[] = [];
    vi.spyOn(Logger.prototype, 'error').mockImplementation((...args) => {
      errors.push(JSON.stringify(args));
    });
    vi.spyOn(Logger.prototype, 'log').mockImplementation((...args) => {
      lines.push(JSON.stringify(args));
    });
    const moduleRef = await withoutTitleBackfill(
      Test.createTestingModule({ imports: [ProbeModule] }),
    ).compile();
    const app = moduleRef.createNestApplication();

    await app.init();
    await app.get(TitleBackfill).whenDone();
    await app.close();

    expect(errors).toEqual([]);
    expect(snapshots.gets).toEqual([]);
    expect(
      lines.filter((l) => l.includes('assessment_title_backfill')),
    ).toEqual([expect.stringContaining('"scanned":0')]);
  });
});
