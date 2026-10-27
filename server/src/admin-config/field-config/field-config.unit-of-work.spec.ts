// @akili-spec admin-config/field-configuration
import { drizzle } from 'drizzle-orm/mysql2';
import { describe, expect, it } from 'vitest';
import { InMemoryCyclesUnitOfWork } from '../../../test/support/in-memory-admin-config.js';
import {
  InMemoryFieldConfigDatabase,
  InMemoryFieldConfigUnitOfWork,
} from '../../../test/support/in-memory-field-config.js';
import { FakeClock } from '../../../test/support/in-memory-idempotency.js';
import type { Reservation } from '../../common/idempotency/idempotency.store.js';
import * as schema from '../../database/drizzle/schema/index.js';
import { FieldConfigRevisionStaleError } from '../admin-config.errors.js';
import type { ConfigItem } from './field-config-diff.js';
import { DrizzleFieldConfigStore } from './field-config.store.js';
import {
  DrizzleFieldConfigUnitOfWork,
  type FieldConfigRepositories,
} from './field-config.unit-of-work.js';

// Expected values are design 7.2 / 7.3 and the FR-5, FR-8, FR-11, NFR-3, NFR-5
// scenarios written out. Two layers, as there is no disposable MySQL (the shared
// qadb is never touched):
//  - the real Drizzle adapters over a stub MySQL driver: the SQL they send, in
//    which order, on which connection, and what a duplicate key or an affected-row
//    count turns into;
//  - the in-memory world, whose fake interleaves at every statement and emulates
//    the locks InnoDB takes (cycle S, draft X, the unique entry of a version
//    number): the concurrency cases.
// Fakes cannot show InnoDB's own behavior (KZ-admin-config--cycle-timelines-1):
// T-11 is the HITL run on MySQL.

const at = '2026-10-19 10:00:00';
const FIXED = new Date('2026-10-20T10:00:00.000Z');
const change = { updatedAt: FIXED, updatedBy: 9 };

/** `n` option sets of one result type: a third of each visibility, flags only on assessed fields (FR-4). */
function configItems(count: number, resultTypeKey = 'policy_change') {
  return Array.from({ length: count }, (_, i): ConfigItem => {
    const visibility = (['hidden', 'view_only', 'assessed'] as const)[i % 3]!;
    const assessed = visibility === 'assessed';
    return {
      resultTypeKey,
      fieldKey: `field_${String(i + 1).padStart(3, '0')}`,
      visibility,
      isCore: assessed && i % 2 === 0,
      isAiInput: assessed && i % 4 === 0,
    };
  });
}

const changesOf = (items: readonly ConfigItem[]) =>
  Object.fromEntries(
    items.map((item) => [
      `${item.resultTypeKey}.${item.fieldKey}`,
      {
        before: null,
        after: {
          visibility: item.visibility,
          isCore: item.isCore,
          isAiInput: item.isAiInput,
        },
      },
    ]),
  );

interface PublishPlan {
  cycleId: number;
  /** The draft revision the ADMIN reviewed. */
  revision: number;
  /** One option set per applicable field (DD-2). */
  items: readonly ConfigItem[];
  /** The key of a keyed request: marked in the same transaction (DD-9). */
  reservation?: Reservation;
}

interface PublishHooks {
  /** Called with the revision `lockDraft` returned, once the lock is held. */
  onLocked?: (revision: number | undefined) => void;
}

/**
 * Design 7.2, publish step 3, as the service will run it: the cycle FOR SHARE,
 * the draft FOR UPDATE with its revision re-checked under the lock (as the
 * timeline edit re-checks its version), the conditional UPDATE (the database
 * decides a race: 0 rows is stale), the number read under the lock, the version,
 * its items, the audit row, the key mark. A `duplicate` on the version insert is
 * the same answer as a stale revision (KZ-admin-config--cycle-timelines-1: no
 * retry loop). Nothing is written before the checks pass. The bump passes no
 * `change`: a publish leaves `updated_*` as the last draft write set them
 * (design 7.3).
 */
const publishWork =
  (plan: PublishPlan, { onLocked }: PublishHooks = {}) =>
  async ({ fieldConfig, idempotency }: FieldConfigRepositories) => {
    await fieldConfig.lockCycleShared(plan.cycleId);
    const locked = await fieldConfig.lockDraft(plan.cycleId);
    onLocked?.(locked?.revision);
    if (locked?.revision !== plan.revision) {
      throw new FieldConfigRevisionStaleError();
    }
    const bumped = await fieldConfig.bumpRevision(
      plan.cycleId,
      undefined,
      plan.revision,
    );
    if (bumped.kind === 'stale') throw new FieldConfigRevisionStaleError();
    const latest = await fieldConfig.latestVersion(plan.cycleId);
    const number = (latest?.number ?? 0) + 1;
    const created = await fieldConfig.insertVersion({
      cycleId: plan.cycleId,
      number,
      catalogVersion: '2026.30',
      publishedAt: FIXED,
      publishedBy: 9,
      requestId: 'req-1',
    });
    if (created.kind === 'duplicate') throw new FieldConfigRevisionStaleError();
    await fieldConfig.insertVersionItems(created.versionId, plan.items);
    await fieldConfig.insertAuditEvent({
      cycleId: plan.cycleId,
      versionId: created.versionId,
      actorId: 9,
      action: 'publish',
      changes: changesOf(plan.items),
      timelines: { receive: [2], keep: [{ id: 1, version: 1 }] },
      requestId: 'req-1',
      createdAt: FIXED,
    });
    if (plan.reservation) {
      await idempotency.markExecuted(plan.reservation, created.versionId);
    }
    return { versionId: created.versionId, number };
  };

// --- the Drizzle adapters over a stub MySQL driver ---------------------------

interface Statement {
  via: 'pool' | 'tx';
  sql: string;
  params: unknown[];
}

const duplicate = (key: string) =>
  Object.assign(new Error(`Duplicate entry '3-2' for key '${key}'`), {
    code: 'ER_DUP_ENTRY',
    errno: 1062,
    sqlMessage: `Duplicate entry '3-2' for key '${key}'`,
  });

interface StubOptions {
  /** The revision the draft row has when it is read (default 7). */
  draftRevision?: number;
  /** Rows the UPDATE of `field_config_drafts` matches (default 1): 0 is a lost revision race (DD-6). */
  bumpRows?: number;
  /** Rows the UPDATE of `idempotency_keys` matches (default 1). */
  fenceRows?: number;
  /** The number of the cycle's latest version, `null` for none (default 1). */
  latestNumber?: number | null;
  /** The insert into `field_config_versions` is refused with this error. */
  versionInsertError?: Error;
  /** Rows `select` returns for the draft and version items (default 3). */
  itemCount?: number;
  /** Timelines the cycle has (default 2). */
  timelineCount?: number;
}

function stub({
  draftRevision = 7,
  bumpRows = 1,
  fenceRows = 1,
  latestNumber = 1,
  versionInsertError,
  itemCount = 3,
  timelineCount = 2,
}: StubOptions = {}) {
  const log: Statement[] = [];
  const answer = (via: Statement['via']) => ({
    query: ({ sql }: { sql: string }, values?: unknown[]) => {
      log.push({ via, sql, params: values ?? [] });
      if (sql.startsWith('insert into `field_config_versions`')) {
        if (versionInsertError) return Promise.reject(versionInsertError);
        return Promise.resolve([{ insertId: 31, affectedRows: 1 }, []]);
      }
      if (sql.startsWith('insert')) {
        return Promise.resolve([{ insertId: 0, affectedRows: 1 }, []]);
      }
      if (sql.startsWith('update `field_config_drafts`')) {
        return Promise.resolve([{ affectedRows: bumpRows }, []]);
      }
      if (sql.startsWith('update `idempotency_keys`')) {
        return Promise.resolve([{ affectedRows: fenceRows }, []]);
      }
      if (!sql.startsWith('select')) {
        return Promise.resolve([{ affectedRows: 1 }, []]);
      }
      let rows: unknown[][] = [];
      switch (/from `(\w+)`/.exec(sql)?.[1]) {
        case 'cycles':
          // The FOR SHARE read answers the status only; the plain read, id, year, status.
          rows = sql.endsWith('for share')
            ? [['active']]
            : [[3, 2026, 'active']];
          break;
        case 'field_config_drafts':
          // cycle_id, revision, updated_at, updated_by.
          rows = [[3, draftRevision, at, 1]];
          break;
        case 'field_config_draft_items':
        case 'field_config_version_items':
          // result_type_key, field_key, visibility, is_core, is_ai_input.
          rows = Array.from({ length: itemCount }, (_, i) => [
            'policy_change',
            `field_${String(i + 1).padStart(3, '0')}`,
            'assessed',
            1,
            0,
          ]);
          break;
        case 'field_config_versions':
          // id, cycle_id, number, catalog_version, published_at, published_by, request_id.
          rows =
            latestNumber === null
              ? []
              : [[31, 3, latestNumber, '2026.29', at, 1, null]];
          break;
        case 'timelines':
          // id, name, all_result_types: the odd ones are for every type.
          rows = Array.from({ length: timelineCount }, (_, i) => [
            100 + i,
            `Timeline ${100 + i}`,
            i % 2,
          ]);
          break;
        case 'timeline_steps':
          // timeline_id, position, opens_on, closes_on; step 2 first on purpose.
          rows = Array.from({ length: timelineCount }, (_, i) => [
            [100 + i, 2, '2026-11-09', '2026-11-13'],
            [100 + i, 1, '2026-11-02', '2026-11-06'],
          ]).flat();
          break;
        case 'timeline_result_types':
          // timeline_id, result_type_key, only for the timelines that are not for every type.
          rows = Array.from({ length: timelineCount }, (_, i) => i)
            .filter((i) => i % 2 === 0)
            .map((i) => [100 + i, 'policy_change']);
          break;
        default:
          break;
      }
      return Promise.resolve([rows, []]);
    },
  });
  // A pool, as in production: a transaction takes one connection from it.
  const pool = {
    ...answer('pool'),
    getConnection: async () => ({ ...answer('tx'), release: () => {} }),
  };
  const db = drizzle({ client: pool as never, schema, mode: 'default' });
  return { db, log };
}

const inTransaction = (log: Statement[]) =>
  log.filter((s) => s.sql !== 'set transaction isolation level read committed');
const verb = (s: Statement) => s.sql.split(' ')[0];
const tableOf = (s: Statement) =>
  /(?:from|into|update) `(\w+)`/.exec(s.sql)?.[1];
const keyed: Reservation = { actorId: 9, key: 'k-1', ownerToken: 'token-1' };

describe('DrizzleFieldConfigUnitOfWork over a stub MySQL driver (design 7.2, 7.3, DD-6, NFR-5)', () => {
  const plan: PublishPlan = {
    cycleId: 3,
    revision: 7,
    items: configItems(13),
    reservation: keyed,
  };

  it('a publish: READ COMMITTED, the cycle FOR SHARE, the draft FOR UPDATE, the conditional UPDATE with the revision in its WHERE, the number, the version, its items in ONE INSERT, the audit INSERT, the key mark, commit, all on the transaction connection', async () => {
    const { db, log } = stub();

    const result = await new DrizzleFieldConfigUnitOfWork(db).run(
      publishWork(plan),
    );

    expect(result).toEqual({ versionId: 31, number: 2 });
    expect(log.slice(0, 2).map((s) => s.sql)).toEqual([
      'set transaction isolation level read committed',
      'begin',
    ]);
    const inTx = inTransaction(log);
    // Nothing of the publication, the audit row and the key mark included, ran outside the transaction.
    expect(inTx.map((s) => s.via)).toEqual(inTx.map(() => 'tx'));
    expect(log.filter((s) => s.via === 'pool')).toEqual([]);
    expect(inTx[1]!.sql).toMatch(
      /from `cycles` where `cycles`\.`id` = \? limit \? for share$/,
    );
    expect(inTx[1]!.params[0]).toBe(3);
    expect(inTx[2]!.sql).toMatch(
      /from `field_config_drafts` where `field_config_drafts`\.`cycle_id` = \? limit \? for update$/,
    );
    expect(inTx[2]!.params[0]).toBe(3);
    // The revision is in the WHERE of the UPDATE, and the UPDATE raises it by one.
    const bump = inTx[3]!;
    expect(bump.sql).toMatch(/^update `field_config_drafts` set /);
    expect(bump.sql).toMatch(/`revision` = .*`revision` \+ 1/);
    expect(bump.sql).toMatch(
      /where \(`field_config_drafts`\.`cycle_id` = \? and `field_config_drafts`\.`revision` = \?\)$/,
    );
    expect(bump.params.slice(-2)).toEqual([3, 7]);
    expect(inTx[4]!.sql).toMatch(
      /from `field_config_versions` where `field_config_versions`\.`cycle_id` = \? order by `field_config_versions`\.`number` desc limit \?$/,
    );
    expect(inTx[5]!.sql).toMatch(/^insert into `field_config_versions`/);
    // cycle 3, number 2 (latest 1 + 1), catalog version, publisher, request id.
    expect(inTx[5]!.params).toEqual(
      expect.arrayContaining([3, 2, '2026.30', 9, 'req-1']),
    );
    // The 13 option sets are ONE multi-row INSERT: 13 rows of 6 values.
    expect(inTx[6]!.sql).toMatch(/^insert into `field_config_version_items`/);
    expect(inTx[6]!.params).toHaveLength(13 * 6);
    expect(inTx[6]!.params.slice(0, 6)).toEqual([
      31,
      'policy_change',
      'field_001',
      'hidden',
      false,
      false,
    ]);
    expect(inTx[7]!.sql).toMatch(/^insert into `field_config_audit_events`/);
    expect(inTx[7]!.params).toEqual(
      expect.arrayContaining([3, 31, 9, 'publish', 'req-1']),
    );
    expect(inTx[8]!.sql).toMatch(/^update `idempotency_keys` set /);
    expect(inTx.at(-1)!.sql).toBe('commit');
    expect(inTx).toHaveLength(10);
  });

  it('the conditional UPDATE answers by its affected rows alone: 1 is updated, 0 is stale, and no read runs before it', async () => {
    for (const [rows, kind] of [
      [1, 'updated'],
      [0, 'stale'],
    ] as const) {
      const { db, log } = stub({ bumpRows: rows });

      const outcome = await new DrizzleFieldConfigUnitOfWork(db).run(
        ({ fieldConfig }) => fieldConfig.bumpRevision(3, change, 7),
      );

      expect(outcome).toEqual({ kind });
      expect(inTransaction(log).map(verb)).toEqual([
        'begin',
        'update',
        'commit',
      ]);
    }
  });

  it('a publish raises the revision and nothing else, so `updated_at`/`updated_by` stay as the last draft write set them; a draft write raises it and sets its writer (design 7.2 publish step 3, 7.3)', async () => {
    const published = stub();
    await new DrizzleFieldConfigUnitOfWork(published.db).run(publishWork(plan));
    const publishBump = inTransaction(published.log).find((s) =>
      s.sql.startsWith('update `field_config_drafts`'),
    )!;
    const [publishSet] = publishBump.sql.split(' where ');
    expect(publishSet).toMatch(
      /^update `field_config_drafts` set `revision` = (`field_config_drafts`\.)?`revision` \+ 1$/,
    );
    expect(publishSet).not.toMatch(/updated_/);
    // The cycle and the expected revision, nothing else.
    expect(publishBump.params).toEqual([3, 7]);

    const edited = stub();
    await new DrizzleFieldConfigUnitOfWork(edited.db).run(({ fieldConfig }) =>
      fieldConfig.bumpRevision(3, change),
    );
    const editBump = inTransaction(edited.log)[1]!;
    const [editSet] = editBump.sql.split(' where ');
    expect(editSet).toMatch(
      /^update `field_config_drafts` set `revision` = (`field_config_drafts`\.)?`revision` \+ 1, `updated_at` = \?, `updated_by` = \?$/,
    );
    // When, who, then the cycle.
    expect(editBump.params).toHaveLength(3);
    expect(editBump.params.slice(1)).toEqual([9, 3]);
  });

  it('without an expected revision the bump is unconditional: the WHERE names the cycle only', async () => {
    const { db, log } = stub();

    const outcome = await new DrizzleFieldConfigUnitOfWork(db).run(
      ({ fieldConfig }) => fieldConfig.bumpRevision(3, change),
    );

    expect(outcome).toEqual({ kind: 'updated' });
    const bump = inTransaction(log)[1]!;
    expect(bump.sql).toMatch(/where `field_config_drafts`\.`cycle_id` = \?$/);
    expect(bump.sql).not.toMatch(/`revision` = \?/);
    expect(bump.params.at(-1)).toBe(3);
  });

  it('a duplicate number (1062 on `uq_field_config_versions_cycle_number`) is `duplicate`, so the publication is refused: rolled back, no items or audit statement, no commit', async () => {
    const { db, log } = stub({
      versionInsertError: duplicate(
        'field_config_versions.uq_field_config_versions_cycle_number',
      ),
    });

    await expect(
      new DrizzleFieldConfigUnitOfWork(db).run(publishWork(plan)),
    ).rejects.toBeInstanceOf(FieldConfigRevisionStaleError);

    const sqls = log.map((s) => s.sql);
    expect(sqls.at(-1)).toBe('rollback');
    expect(sqls).not.toContain('commit');
    expect(
      sqls.filter((s) => s.startsWith('insert into `field_config_ver')),
    ).toHaveLength(1);
    expect(
      sqls.filter((s) => s.startsWith('insert into `field_config_audit')),
    ).toEqual([]);
    expect(
      sqls.filter((s) => s.startsWith('update `idempotency_keys`')),
    ).toEqual([]);
  });

  it('a duplicate key wrapped as the cause of another error is still `duplicate`; any other failure of the version insert is thrown, rolled back, never read as stale', async () => {
    const wrapped = Object.assign(new Error('Failed query'), {
      cause: duplicate(
        'field_config_versions.uq_field_config_versions_cycle_number',
      ),
    });
    const outcome = await new DrizzleFieldConfigUnitOfWork(
      stub({ versionInsertError: wrapped }).db,
    ).run(({ fieldConfig }) =>
      fieldConfig.insertVersion({
        cycleId: 3,
        number: 2,
        catalogVersion: '2026.30',
        publishedAt: FIXED,
        publishedBy: 9,
        requestId: null,
      }),
    );
    expect(outcome).toEqual({ kind: 'duplicate' });

    const deadlock = Object.assign(new Error('Deadlock found'), {
      code: 'ER_LOCK_DEADLOCK',
      errno: 1213,
    });
    const other = stub({ versionInsertError: deadlock });
    const refused: unknown = await new DrizzleFieldConfigUnitOfWork(other.db)
      .run(publishWork(plan))
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(Error);
    expect(refused).not.toBeInstanceOf(FieldConfigRevisionStaleError);
    expect((refused as { cause?: unknown }).cause).toBe(deadlock);
    expect(other.log.at(-1)!.sql).toBe('rollback');
  });

  it('the draft statements: the first write creates the row (insert, the key onto itself on a duplicate), items are ONE upsert, a discard is a DELETE then ONE INSERT ... SELECT', async () => {
    const { db, log } = stub();

    await new DrizzleFieldConfigUnitOfWork(db).run(async ({ fieldConfig }) => {
      await fieldConfig.ensureDraft(3);
      await fieldConfig.upsertDraftItems(3, configItems(2));
      await fieldConfig.deleteDraftItems(3);
      await fieldConfig.copyVersionToDraft(3, 31);
    });

    const [ensure, upsert, remove, copy] = inTransaction(log).slice(1, 5);
    expect(ensure!.sql).toMatch(
      /^insert into `field_config_drafts` .* on duplicate key update `cycle_id` = \?$/,
    );
    expect(ensure!.params).toEqual(expect.arrayContaining([3]));
    expect(upsert!.sql).toMatch(
      /^insert into `field_config_draft_items` .* values \(.*\), \(.*\) on duplicate key update /,
    );
    expect(upsert!.sql).toMatch(/`visibility` = values\(`visibility`\)/);
    expect(upsert!.sql).toMatch(/`is_core` = values\(`is_core`\)/);
    expect(upsert!.sql).toMatch(/`is_ai_input` = values\(`is_ai_input`\)/);
    expect(upsert!.params).toHaveLength(2 * 6);
    expect(upsert!.params.slice(0, 6)).toEqual([
      3,
      'policy_change',
      'field_001',
      'hidden',
      false,
      false,
    ]);
    expect(remove!.sql).toBe(
      'delete from `field_config_draft_items` where `field_config_draft_items`.`cycle_id` = ?',
    );
    expect(remove!.params).toEqual([3]);
    expect(copy!.sql).toMatch(
      /^insert into `field_config_draft_items` \(`cycle_id`, `result_type_key`, `field_key`, `visibility`, `is_core`, `is_ai_input`\) select .* from `field_config_version_items` where `field_config_version_items`\.`version_id` = \?$/,
    );
    expect(copy!.params).toEqual([3, 31]);
  });

  it('an empty list of items is no statement at all', async () => {
    const { db, log } = stub();

    await new DrizzleFieldConfigUnitOfWork(db).run(async ({ fieldConfig }) => {
      await fieldConfig.upsertDraftItems(3, []);
      await fieldConfig.insertVersionItems(31, []);
    });

    expect(inTransaction(log).map(verb)).toEqual(['begin', 'commit']);
  });

  it('a draft edit takes the locks in the order of design 7.2: the cycle FOR SHARE, the draft row created if absent, then locked FOR UPDATE, then the writes', async () => {
    const { db, log } = stub();

    await new DrizzleFieldConfigUnitOfWork(db).run(async ({ fieldConfig }) => {
      await fieldConfig.lockCycleShared(3);
      await fieldConfig.ensureDraft(3);
      await fieldConfig.lockDraft(3);
      await fieldConfig.upsertDraftItems(3, configItems(3));
      await fieldConfig.bumpRevision(3, change);
    });

    const inTx = inTransaction(log);
    expect(inTx.map((s) => `${verb(s)} ${tableOf(s) ?? ''}`.trim())).toEqual([
      'begin',
      'select cycles',
      'insert field_config_drafts',
      'select field_config_drafts',
      'insert field_config_draft_items',
      'update field_config_drafts',
      'commit',
    ]);
    expect(inTx[1]!.sql).toMatch(/for share$/);
    expect(inTx[3]!.sql).toMatch(/for update$/);
  });

  it('the reads are plain statements on the pool, one each: cycle, draft, draft items, latest version, a version items, the versions', async () => {
    const { db, log } = stub({ itemCount: 4 });
    const store = new DrizzleFieldConfigStore(db);

    const cycle = await store.findCycle(3);
    const draft = await store.findDraft(3);
    const draftItems = await store.listDraftItems(3);
    const latest = await store.latestVersion(3);
    const versionItems = await store.listVersionItems(31, 'policy_change');
    const versions = await store.listVersions(3);

    expect(log.map((s) => [s.via, tableOf(s)])).toEqual([
      ['pool', 'cycles'],
      ['pool', 'field_config_drafts'],
      ['pool', 'field_config_draft_items'],
      ['pool', 'field_config_versions'],
      ['pool', 'field_config_version_items'],
      ['pool', 'field_config_versions'],
    ]);
    expect(log.some((s) => /for (update|share)/.test(s.sql))).toBe(false);
    expect(cycle).toEqual({ id: 3, year: 2026, status: 'active' });
    expect(draft).toMatchObject({ cycleId: 3, revision: 7, updatedBy: 1 });
    expect(draftItems).toHaveLength(4);
    expect(draftItems[0]).toEqual({
      resultTypeKey: 'policy_change',
      fieldKey: 'field_001',
      visibility: 'assessed',
      isCore: true,
      isAiInput: false,
    });
    expect(latest).toMatchObject({ id: 31, cycleId: 3, number: 1 });
    expect(versionItems).toHaveLength(4);
    // The type filter is in the WHERE of the version items statement.
    expect(log[4]!.sql).toMatch(/`result_type_key` = \?/);
    expect(log[4]!.params).toEqual([31, 'policy_change']);
    expect(versions).toHaveLength(1);
    expect(log[5]!.sql).toMatch(/order by `field_config_versions`\.`number`/);
  });

  it('listTimelineStarts is three statements on the pool for one timeline, for fifty and for none, and maps the rows', async () => {
    const run = async (timelineCount: number) => {
      const { db, log } = stub({ timelineCount });
      const starts = await new DrizzleFieldConfigStore(db).listTimelineStarts(
        3,
      );
      return { starts, log };
    };

    const one = await run(1);
    const fifty = await run(50);
    const none = await run(0);

    for (const { log } of [one, fifty, none]) {
      expect(log.map((s) => [s.via, tableOf(s)])).toEqual([
        ['pool', 'timelines'],
        ['pool', 'timeline_steps'],
        ['pool', 'timeline_result_types'],
      ]);
      expect(log.map((s) => s.params)).toEqual([[3], [3], [3]]);
    }
    // The steps and scope rows are keyed by the cycle, so no statement depends on the first one's ids.
    expect(one.log[1]!.sql).toMatch(
      /where `timeline_steps`\.`timeline_id` in \(select `id` from `timelines` where `timelines`\.`cycle_id` = \?\)/,
    );
    expect(one.log[2]!.sql).toMatch(
      /where `timeline_result_types`\.`timeline_id` in \(select `id` from `timelines` where `timelines`\.`cycle_id` = \?\)/,
    );
    expect(one.starts).toEqual([
      {
        id: 100,
        name: 'Timeline 100',
        // Step 1's opening and the latest closing, whatever the order the rows come in.
        opensAt: '2026-11-02',
        closesAt: '2026-11-13',
        allResultTypes: false,
        resultTypeKeys: ['policy_change'],
      },
    ]);
    expect(fifty.starts).toHaveLength(50);
    expect(fifty.starts[1]).toEqual({
      id: 101,
      name: 'Timeline 101',
      opensAt: '2026-11-02',
      closesAt: '2026-11-13',
      allResultTypes: true,
      resultTypeKeys: [],
    });
    expect(none.starts).toEqual([]);
  });

  it('the statements of a publication do not depend on how many fields it has: the same count for 13 and for 40 applicable fields, and the items stay ONE statement', async () => {
    const total = async (fields: number) => {
      const { db, log } = stub({ itemCount: fields });
      const store = new DrizzleFieldConfigStore(db);
      // Design 7.2, publish step 2: the reads before the transaction.
      await store.findCycle(3);
      await store.findDraft(3);
      await store.listDraftItems(3);
      const latest = await store.latestVersion(3);
      await store.listVersionItems(latest?.id ?? 0);
      await store.listVersions(3);
      await store.listTimelineStarts(3);
      await new DrizzleFieldConfigUnitOfWork(db).run(
        publishWork({ ...plan, items: configItems(fields) }),
      );
      return {
        statements: log.length,
        itemInserts: log.filter((s) =>
          s.sql.startsWith('insert into `field_config_version_items`'),
        ).length,
      };
    };

    const thirteen = await total(13);
    const forty = await total(40);

    // 9 reads (the last one is three), then set isolation, begin, the cycle, the
    // draft, the bump, the number, the version, its items, the audit row, the
    // key mark, commit.
    expect(thirteen).toEqual({ statements: 20, itemInserts: 1 });
    expect(forty).toEqual(thirteen);
  });

  it('a draft edit is the same statements for 3 items and for 2,000', async () => {
    const total = async (count: number) => {
      const { db, log } = stub();
      await new DrizzleFieldConfigUnitOfWork(db).run(
        async ({ fieldConfig }) => {
          await fieldConfig.lockCycleShared(3);
          await fieldConfig.ensureDraft(3);
          await fieldConfig.lockDraft(3);
          await fieldConfig.upsertDraftItems(3, configItems(count));
          await fieldConfig.bumpRevision(3, change);
        },
      );
      return log.length;
    };

    // set isolation, begin, the cycle, ensure, the draft, the upsert, the bump, commit.
    expect(await total(3)).toBe(8);
    expect(await total(2000)).toBe(8);
  });
});

// --- the in-memory world ------------------------------------------------------

describe('the field configuration over the in-memory world (FR-5, FR-8, FR-11, NFR-3, NFR-5; the fake interleaves at every statement)', () => {
  /**
   * One active cycle 1 with its draft at revision 7 (five items) and version 1
   * (the same five items), as a cycle looks after its first publication and one
   * later edit.
   */
  function seed({ withDraft = true, withVersion = true, fields = 5 } = {}) {
    const db = new InMemoryFieldConfigDatabase();
    const created = new Date('2026-10-01T09:00:00.000Z');
    db.world.cycles.push({
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
    if (withDraft) {
      db.drafts.push({
        cycleId: 1,
        revision: 7,
        updatedAt: created,
        updatedBy: 1,
      });
      db.draftItems.push(
        ...configItems(fields).map((item) => ({ cycleId: 1, ...item })),
      );
    }
    if (withVersion) {
      db.versions.push({
        id: 1,
        cycleId: 1,
        number: 1,
        catalogVersion: '2026.29',
        publishedAt: created,
        publishedBy: 1,
        requestId: null,
      });
      db.versionItems.push(
        ...configItems(fields).map((item) => ({ versionId: 1, ...item })),
      );
    }
    return { db, uow: new InMemoryFieldConfigUnitOfWork(db) };
  }

  const committed = (db: InMemoryFieldConfigDatabase) =>
    structuredClone({
      drafts: db.drafts,
      draftItems: db.draftItems,
      versions: db.versions,
      versionItems: db.versionItems,
      audit: db.auditEvents,
      idempotency: db.base.idempotency,
    });

  const reserve = async (db: InMemoryFieldConfigDatabase) => {
    const outcome = await db.base
      .idempotencyStore(new FakeClock().now)
      .reserve({
        actorId: 9,
        key: 'k-1',
        fingerprint: 'f'.repeat(64),
        routeStatus: 201,
      });
    if (outcome.kind !== 'reserved') throw new Error(outcome.kind);
    return outcome.reservation;
  };

  const plan: PublishPlan = { cycleId: 1, revision: 7, items: configItems(13) };

  it('a publication commits the revision bump, the version, its items, exactly one audit row and the key mark together', async () => {
    const { db, uow } = seed();
    const reservation = await reserve(db);

    const result = await uow.run(publishWork({ ...plan, reservation }));

    expect(result).toEqual({ versionId: 2, number: 2 });
    // The publish raises the revision only: `updated_at`/`updated_by` stay as
    // the last draft write set them (user 1 on 1 October), not the publisher's
    // 9 at the publish instant (design 7.2 publish step 3, 7.3).
    expect(db.drafts).toEqual([
      {
        cycleId: 1,
        revision: 8,
        updatedAt: new Date('2026-10-01T09:00:00.000Z'),
        updatedBy: 1,
      },
    ]);
    expect(db.versions.find((v) => v.number === 2)).toEqual({
      id: 2,
      cycleId: 1,
      number: 2,
      catalogVersion: '2026.30',
      publishedAt: FIXED,
      publishedBy: 9,
      requestId: 'req-1',
    });
    expect(db.versionItems.filter((i) => i.versionId === 2)).toHaveLength(13);
    expect(db.auditEvents).toEqual([
      expect.objectContaining({
        cycleId: 1,
        versionId: 2,
        actorId: 9,
        action: 'publish',
        timelines: { receive: [2], keep: [{ id: 1, version: 1 }] },
        requestId: 'req-1',
        createdAt: FIXED,
      }),
    ]);
    expect(Object.keys(db.auditEvents[0]!.changes)).toHaveLength(13);
    // Version 1 is untouched (FR-12).
    expect(db.versions.find((v) => v.number === 1)).toMatchObject({
      publishedBy: 1,
      catalogVersion: '2026.29',
    });
    expect(db.versionItems.filter((i) => i.versionId === 1)).toHaveLength(5);
    expect(db.base.idempotency[0]).toMatchObject({
      state: 'executed',
      targetUserId: 2,
    });
    expect([uow.begun, uow.committed, uow.rolledBack]).toEqual([1, 1, 0]);
  });

  it('a rollback after every write leaves no draft, version, item, audit or key change', async () => {
    const { db, uow } = seed();
    const reservation = await reserve(db);
    const before = committed(db);

    await expect(
      uow.run(async (repositories) => {
        const { fieldConfig } = repositories;
        await fieldConfig.lockCycleShared(1);
        await fieldConfig.ensureDraft(1);
        await fieldConfig.lockDraft(1);
        await fieldConfig.upsertDraftItems(
          1,
          configItems(3, 'knowledge_product'),
        );
        await fieldConfig.bumpRevision(1, change);
        await fieldConfig.deleteDraftItems(1);
        await fieldConfig.copyVersionToDraft(1, 1);
        // The revision is 8 inside this transaction: its own bump above.
        await publishWork({ ...plan, revision: 8, reservation })(repositories);
        throw new Error('the answer was lost');
      }),
    ).rejects.toThrow('the answer was lost');

    // Every write really ran (the log keeps rolled-back statements) ...
    expect(db.writeLog).toEqual([
      'draft-items:upsert:1',
      'draft:bump:1',
      'draft-items:delete:1',
      'draft-items:copy:1',
      'draft:bump:1',
      'version:insert:1:2',
      'version-items:insert:2',
      'audit:2',
    ]);
    // ... and none of it is committed, the audit row and the key mark included.
    expect(committed(db)).toEqual(before);
    expect(db.auditEvents).toHaveLength(0);
    expect(db.base.idempotency[0]).toMatchObject({ state: 'in_progress' });
    expect([uow.committed, uow.rolledBack]).toEqual([0, 1]);
  });

  it('a rollback of the first draft write leaves no draft row either', async () => {
    const { db, uow } = seed({ withDraft: false, withVersion: false });

    await expect(
      uow.run(async ({ fieldConfig }) => {
        await fieldConfig.lockCycleShared(1);
        await fieldConfig.ensureDraft(1);
        const draft = await fieldConfig.lockDraft(1);
        expect(draft).toMatchObject({ cycleId: 1, revision: 0 });
        await fieldConfig.upsertDraftItems(1, configItems(2));
        await fieldConfig.bumpRevision(1, change);
        throw new Error('the answer was lost');
      }),
    ).rejects.toThrow('the answer was lost');

    expect(db.writeLog).toEqual([
      'draft:ensure:1',
      'draft-items:upsert:1',
      'draft:bump:1',
    ]);
    expect(db.drafts).toEqual([]);
    expect(db.draftItems).toEqual([]);
  });

  it('a duplicate number refuses the publication: the version insert answers `duplicate` and nothing of it is committed', async () => {
    const { db, uow } = seed();
    const before = committed(db);

    await expect(
      uow.run(async (repositories) => {
        // Number 1 is taken by version 1: the backstop, as if the guard had been missed.
        const created = await repositories.fieldConfig.insertVersion({
          cycleId: 1,
          number: 1,
          catalogVersion: '2026.30',
          publishedAt: FIXED,
          publishedBy: 9,
          requestId: 'req-1',
        });
        expect(created).toEqual({ kind: 'duplicate' });
        throw new FieldConfigRevisionStaleError();
      }),
    ).rejects.toBeInstanceOf(FieldConfigRevisionStaleError);

    expect(committed(db)).toEqual(before);
    expect(db.writeLog).toEqual([]);
  });

  it('two publications on the same revision run at once: one is updated, the other waits for the first commit, then sees the revision moved and is stale', async () => {
    const { db } = seed();
    const first = new InMemoryFieldConfigUnitOfWork(db);
    const second = new InMemoryFieldConfigUnitOfWork(db);
    const commits = () => first.committed + second.committed;
    const events: string[] = [];
    const publish =
      (who: string) => (repositories: FieldConfigRepositories) => {
        events.push(`${who} requested after ${commits()} commits`);
        return publishWork(plan, {
          onLocked: (revision) =>
            events.push(
              `${who} locked r${revision} after ${commits()} commits`,
            ),
        })(repositories);
      };

    const settled = await Promise.allSettled([
      first.run(publish('Ana')),
      second.run(publish('Luis')),
    ]);

    // The outcome first (NFR-3): exactly one publication, never two.
    expect(
      settled.map((s) =>
        s.status === 'fulfilled'
          ? 'updated'
          : s.reason instanceof FieldConfigRevisionStaleError
            ? 'stale'
            : 'failed',
      ),
    ).toEqual(['updated', 'stale']);
    // One version 2 and one audit row; Luis wrote nothing.
    expect(db.versions.map((v) => v.number)).toEqual([1, 2]);
    expect(db.auditEvents).toHaveLength(1);
    expect(db.drafts[0]).toMatchObject({ revision: 8 });
    expect([second.committed, second.rolledBack]).toEqual([0, 1]);
    expect(db.writeLog.filter((w) => w === 'draft:bump:1')).toHaveLength(1);
    // Luis asked while Ana was in flight (her draft lock held past her first
    // write, to her commit) and got the row only after it.
    expect(events).toEqual([
      'Ana requested after 0 commits',
      'Luis requested after 0 commits',
      'Ana locked r7 after 0 commits',
      'Luis locked r8 after 1 commits',
    ]);
  });

  it('the conditional UPDATE alone refuses the second of two same-revision writes: the revision is checked under the row lock, which is held until the commit', async () => {
    const { db } = seed();
    const first = new InMemoryFieldConfigUnitOfWork(db);
    const second = new InMemoryFieldConfigUnitOfWork(db);
    const commits = () => first.committed + second.committed;
    const events: string[] = [];
    // No FOR UPDATE read first. Both transactions keep a second statement after
    // the UPDATE (a read of the latest version), so each is still open past its
    // first write when the other one's UPDATE arrives.
    const write =
      (who: string) =>
      async ({ fieldConfig }: FieldConfigRepositories) => {
        events.push(`${who} asks to bump`);
        const outcome = await fieldConfig.bumpRevision(1, change, 7);
        events.push(`${who} bump ${outcome.kind} after ${commits()} commits`);
        await fieldConfig.latestVersion(1);
        events.push(`${who} read after its write`);
        return outcome;
      };

    const outcomes = await Promise.all([
      first.run(write('Ana')),
      second.run(write('Luis')),
    ]);

    expect(outcomes.map((o) => o.kind)).toEqual(['updated', 'stale']);
    expect(events.slice(0, 2)).toEqual([
      'Ana asks to bump',
      'Luis asks to bump',
    ]);
    // Ana's second statement ran before Luis's UPDATE was answered: her lock was held past her first write.
    expect(events.indexOf('Ana read after its write')).toBeLessThan(
      events.indexOf('Luis bump stale after 1 commits'),
    );
    expect(events).toContain('Ana bump updated after 0 commits');
    expect(db.drafts[0]).toMatchObject({ revision: 8, updatedBy: 9 });
    expect(db.writeLog.filter((w) => w === 'draft:bump:1')).toHaveLength(1);
  });

  it('a draft edit racing a publication: the publication locks the draft after the edit commits and its revision check sees the edit', async () => {
    const { db } = seed();
    const edit = new InMemoryFieldConfigUnitOfWork(db);
    const publication = new InMemoryFieldConfigUnitOfWork(db);
    const commits = () => edit.committed + publication.committed;
    const events: string[] = [];
    const editing = edit.run(async ({ fieldConfig }) => {
      await fieldConfig.lockCycleShared(1);
      await fieldConfig.ensureDraft(1);
      const draft = await fieldConfig.lockDraft(1);
      events.push(`Eli locked r${draft?.revision}`);
      await fieldConfig.upsertDraftItems(1, [
        {
          ...configItems(1)[0]!,
          visibility: 'view_only',
          isCore: false,
          isAiInput: false,
        },
      ]);
      events.push('Eli upserted');
      const bumped = await fieldConfig.bumpRevision(1, change);
      events.push(`Eli bumped ${bumped.kind}`);
      return bumped;
    });
    const publishing = publication.run((repositories) => {
      events.push(`Pat requested after ${commits()} commits`);
      return publishWork(plan, {
        onLocked: (revision) =>
          events.push(`Pat locked r${revision} after ${commits()} commits`),
      })(repositories);
    });

    const settled = await Promise.allSettled([editing, publishing]);

    // Pat asked while Eli's transaction held the draft row past three writes.
    expect(events).toEqual([
      'Pat requested after 0 commits',
      'Eli locked r7',
      'Eli upserted',
      'Eli bumped updated',
      'Pat locked r8 after 1 commits',
    ]);
    expect(settled[0]).toMatchObject({ status: 'fulfilled' });
    expect(settled[1]).toMatchObject({
      status: 'rejected',
      reason: expect.any(FieldConfigRevisionStaleError),
    });
    // The edit is kept at revision 8; nothing was published.
    expect(db.drafts[0]).toMatchObject({ revision: 8, updatedBy: 9 });
    expect(
      db.draftItems.find((i) => i.fieldKey === 'field_001')?.visibility,
    ).toBe('view_only');
    expect(db.versions.map((v) => v.number)).toEqual([1]);
    expect(db.auditEvents).toEqual([]);
    expect([publication.committed, publication.rolledBack]).toEqual([0, 1]);
  });

  it('a publication racing a draft edit: the edit waits for the publication, lands after it at the next revision, and is not in the version', async () => {
    const { db } = seed();
    const publication = new InMemoryFieldConfigUnitOfWork(db);
    const edit = new InMemoryFieldConfigUnitOfWork(db);
    const commits = () => edit.committed + publication.committed;
    const events: string[] = [];
    const publishing = publication.run(publishWork(plan));
    const editing = edit.run(async ({ fieldConfig }) => {
      events.push(`Eli asks for the draft after ${commits()} commits`);
      await fieldConfig.lockCycleShared(1);
      await fieldConfig.ensureDraft(1);
      events.push(`Eli has the draft after ${commits()} commits`);
      await fieldConfig.upsertDraftItems(1, [
        {
          ...configItems(1)[0]!,
          visibility: 'view_only',
          isCore: false,
          isAiInput: false,
        },
      ]);
      return fieldConfig.bumpRevision(1, change);
    });

    const [published, edited] = await Promise.all([publishing, editing]);

    expect(published).toEqual({ versionId: 2, number: 2 });
    expect(edited).toEqual({ kind: 'updated' });
    expect(events).toEqual([
      'Eli asks for the draft after 0 commits',
      'Eli has the draft after 1 commits',
    ]);
    // Revision 7 -> 8 (publication) -> 9 (edit). The edit is in the draft, not in version 2.
    expect(db.drafts[0]).toMatchObject({ revision: 9 });
    expect(
      db.draftItems.find((i) => i.fieldKey === 'field_001')?.visibility,
    ).toBe('view_only');
    expect(
      db.versionItems.find(
        (i) => i.versionId === 2 && i.fieldKey === 'field_001',
      )?.visibility,
    ).toBe('hidden');
    expect(db.versions.map((v) => v.number)).toEqual([1, 2]);
  });

  it('UNIQUE (cycle, number) is the backstop: two inserts of one number with no other guard give one version, and the second finds the number taken after the first commit', async () => {
    const { db } = seed();
    const first = new InMemoryFieldConfigUnitOfWork(db);
    const second = new InMemoryFieldConfigUnitOfWork(db);
    const commits = () => first.committed + second.committed;
    const events: string[] = [];
    // Both transactions write the version, then a second statement (its items),
    // so both are open past their first write.
    const insertOnly =
      (who: string) =>
      async ({ fieldConfig }: FieldConfigRepositories) => {
        const outcome = await fieldConfig.insertVersion({
          cycleId: 1,
          number: 2,
          catalogVersion: '2026.30',
          publishedAt: FIXED,
          publishedBy: 9,
          requestId: null,
        });
        events.push(`${who} insert ${outcome.kind} after ${commits()} commits`);
        if (outcome.kind === 'duplicate')
          throw new FieldConfigRevisionStaleError();
        await fieldConfig.insertVersionItems(outcome.versionId, configItems(3));
        events.push(`${who} wrote its items`);
        return outcome;
      };

    const settled = await Promise.allSettled([
      first.run(insertOnly('Ana')),
      second.run(insertOnly('Luis')),
    ]);

    expect(events).toEqual([
      'Ana insert created after 0 commits',
      'Ana wrote its items',
      'Luis insert duplicate after 1 commits',
    ]);
    expect(settled[0]).toMatchObject({ status: 'fulfilled' });
    expect(settled[1]).toMatchObject({
      status: 'rejected',
      reason: expect.any(FieldConfigRevisionStaleError),
    });
    expect(db.versions.filter((v) => v.number === 2)).toHaveLength(1);
    expect(db.versionItems.filter((i) => i.versionId !== 1)).toHaveLength(3);
    expect([second.committed, second.rolledBack]).toEqual([0, 1]);
  });

  it('the cycle FOR SHARE is shared with other readers and waits for an activation that holds the cycle FOR UPDATE, then reads the status it committed', async () => {
    const { db } = seed();
    const closing = new InMemoryCyclesUnitOfWork(db.world);
    const first = new InMemoryFieldConfigUnitOfWork(db);
    const second = new InMemoryFieldConfigUnitOfWork(db);
    const events: string[] = [];
    const closed = closing.run(async ({ cycles }) => {
      await cycles.findById(1, { forUpdate: true });
      events.push('close holds the cycle');
      await cycles.markClosed(1, { by: 9, at: FIXED });
      events.push('close wrote the status');
      await cycles.findById(1);
      events.push('close read after its write');
    });
    const share =
      (who: string) =>
      async ({ fieldConfig }: FieldConfigRepositories) => {
        events.push(`${who} asks for the cycle`);
        const status = await fieldConfig.lockCycleShared(1);
        events.push(
          `${who} read ${status} after ${closing.committed} close commits`,
        );
        await fieldConfig.findDraft(1);
        return status;
      };

    const [, a, b] = await Promise.all([
      closed,
      first.run(share('Ana')),
      second.run(share('Luis')),
    ]);

    expect([a, b]).toEqual(['closed', 'closed']);
    // Both shares were requested while the close held the cycle row past its
    // write and its read, and were answered only after its commit.
    expect(events).toEqual([
      'Ana asks for the cycle',
      'Luis asks for the cycle',
      'close holds the cycle',
      'close wrote the status',
      'close read after its write',
      'Ana read closed after 1 close commits',
      'Luis read closed after 1 close commits',
    ]);
    // Two shared locks coexist: neither share transaction waited for the other.
    expect([first.committed, second.committed]).toEqual([1, 1]);
  });

  it('the statements of a publication do not depend on how many fields it has: the same round trips for 13 and for 40 applicable fields', async () => {
    const counts: Array<{ statements: number; writes: string[] }> = [];
    for (const fields of [13, 40]) {
      // The draft and the latest version have `fields` items each.
      const { db, uow } = seed({ fields });
      // Design 7.2, publish step 2: the reads before the transaction.
      await db.store.findCycle(1);
      await db.store.findDraft(1);
      await db.store.listDraftItems(1);
      const latest = await db.store.latestVersion(1);
      await db.store.listVersionItems(latest?.id ?? 0);
      await db.store.listVersions(1);
      await db.store.listTimelineStarts(1);
      await uow.run(publishWork({ ...plan, items: configItems(fields) }));
      counts.push({
        statements: db.statementLog.length,
        writes: [...db.writeLog],
      });
    }

    // 9 reads (listTimelineStarts is three), then the cycle, the draft, the
    // bump, the number, the version, its items, the audit row.
    expect(counts[0]!.statements).toBe(16);
    expect(counts[1]!.statements).toBe(16);
    expect(counts[1]!.writes).toEqual(counts[0]!.writes);
    expect(counts[0]!.writes).toEqual([
      'draft:bump:1',
      'version:insert:1:2',
      'version-items:insert:2',
      'audit:2',
    ]);
  });

  it('a draft edit is the same statements for 3 items and for 2,000', async () => {
    const counts: number[] = [];
    for (const items of [3, 2000]) {
      const { db, uow } = seed({ withDraft: false });
      await uow.run(async ({ fieldConfig }) => {
        await fieldConfig.lockCycleShared(1);
        await fieldConfig.ensureDraft(1);
        await fieldConfig.lockDraft(1);
        await fieldConfig.upsertDraftItems(1, configItems(items));
        await fieldConfig.bumpRevision(1, change);
      });
      expect(db.draftItems).toHaveLength(items);
      counts.push(db.statementLog.length);
    }

    expect(counts).toEqual([5, 5]);
  });

  it("listTimelineStarts is three queries for one timeline and for fifty, and answers step 1's opening, the latest closing and the scope", async () => {
    const scenario = (timelineCount: number) => {
      const { db } = seed();
      for (let id = 1; id <= timelineCount; id++) {
        db.world.timelines.push({
          id,
          cycleId: 1,
          name: `Timeline ${id}`,
          kind: id === 1 ? 'official' : 'additional',
          officialKey: id === 1 ? 1 : null,
          allPrograms: true,
          allResultTypes: id % 2 === 0,
          createdAt: FIXED,
          createdBy: 1,
          version: 1,
          updatedAt: null,
          updatedBy: null,
        });
        // Step 2 is stored before step 1 on purpose: position decides, not row order.
        db.world.steps.push(
          {
            id: id * 10 + 2,
            timelineId: id,
            position: 2,
            name: 'Second',
            audience: 'programs',
            opensAt: '2026-11-09',
            closesAt: '2026-11-13',
            round: 1,
            requiresLoad: false,
          },
          {
            id: id * 10 + 1,
            timelineId: id,
            position: 1,
            name: 'First',
            audience: 'assessors',
            opensAt: '2026-11-02',
            closesAt: '2026-11-06',
            round: 1,
            requiresLoad: true,
          },
        );
        if (id % 2 === 1) {
          db.world.resultTypes.push({
            timelineId: id,
            resultTypeKey: 'policy_change',
          });
        }
      }
      return db;
    };

    const one = scenario(1);
    const startsOfOne = await one.store.listTimelineStarts(1);
    const fifty = scenario(50);
    const startsOfFifty = await fifty.store.listTimelineStarts(1);

    expect(one.statementLog).toHaveLength(3);
    expect(fifty.statementLog).toHaveLength(3);
    expect(startsOfOne).toEqual([
      {
        id: 1,
        name: 'Timeline 1',
        opensAt: '2026-11-02',
        closesAt: '2026-11-13',
        allResultTypes: false,
        resultTypeKeys: ['policy_change'],
      },
    ]);
    expect(startsOfFifty).toHaveLength(50);
    expect(startsOfFifty[1]).toEqual({
      id: 2,
      name: 'Timeline 2',
      opensAt: '2026-11-02',
      closesAt: '2026-11-13',
      allResultTypes: true,
      resultTypeKeys: [],
    });
  });

  it('a timeline with no steps has no opening and no closing, and a cycle with no timelines is still three statements', async () => {
    const { db } = seed();
    db.world.timelines.push({
      id: 1,
      cycleId: 1,
      name: 'Bare',
      kind: 'official',
      officialKey: 1,
      allPrograms: true,
      allResultTypes: true,
      createdAt: FIXED,
      createdBy: 1,
      version: 1,
      updatedAt: null,
      updatedBy: null,
    });

    expect(await db.store.listTimelineStarts(1)).toEqual([
      {
        id: 1,
        name: 'Bare',
        opensAt: null,
        closesAt: null,
        allResultTypes: true,
        resultTypeKeys: [],
      },
    ]);
    db.statementLog.length = 0;
    expect(await db.store.listTimelineStarts(2)).toEqual([]);
    expect(db.statementLog).toHaveLength(3);
  });

  it('the fake refuses what the schema refuses: a flag on a field that is not assessed (3819), a repeated version item, a second audit row for a version', async () => {
    const { db } = seed();

    await expect(
      db.store.insertVersionItems(1, [
        {
          resultTypeKey: 'policy_change',
          fieldKey: 'x',
          visibility: 'view_only',
          isCore: true,
          isAiInput: false,
        },
      ]),
    ).rejects.toMatchObject({ errno: 3819 });
    await expect(
      db.store.insertVersionItems(1, [configItems(1)[0]!]),
    ).rejects.toMatchObject({ errno: 1062 });
    const audit = {
      cycleId: 1,
      versionId: 1,
      actorId: 9,
      action: 'publish' as const,
      changes: {},
      timelines: { receive: [], keep: [] },
      requestId: null,
      createdAt: FIXED,
    };
    await db.store.insertAuditEvent(audit);
    await expect(db.store.insertAuditEvent(audit)).rejects.toMatchObject({
      errno: 1062,
    });
    expect(db.auditEvents).toHaveLength(1);
  });
});
