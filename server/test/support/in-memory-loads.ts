// @akili-spec ingestion/step-1-loads
import type { Cycle } from '../../src/database/drizzle/schema/cycles.js';
import type {
  NewTimelineAuditEvent,
  TimelineAuditEvent,
} from '../../src/database/drizzle/schema/timeline-audit-events.js';
import type { TimelineLoad } from '../../src/database/drizzle/schema/timeline-loads.js';
import type { TimelineProgram } from '../../src/database/drizzle/schema/timeline-programs.js';
import type { TimelineResultType } from '../../src/database/drizzle/schema/timeline-result-types.js';
import type {
  TimelineResult,
  TimelineResultEndReason,
} from '../../src/database/drizzle/schema/timeline-results.js';
import type { TimelineStep } from '../../src/database/drizzle/schema/timeline-steps.js';
import type { Timeline } from '../../src/database/drizzle/schema/timelines.js';
import type {
  CycleMembershipRow,
  LoadEndValues,
  LoadInsertOutcome,
  LoadProgressValues,
  LoadRow,
  LoadsStore,
  LockedCycle,
  MembershipInsertOutcome,
  NewLoadValues,
  NewMembershipValues,
  StepOne,
} from '../../src/ingestion/loads.store.js';
import type {
  LoadsRepositories,
  LoadsTransactions,
} from '../../src/ingestion/loads.unit-of-work.js';
import { InMemoryAdminConfigDatabase } from './in-memory-admin-config.js';
import { roundTrip } from './in-memory-idempotency.js';
import type {
  InMemoryTransaction,
  IsolationLevel,
  StatementOptions,
} from './in-memory-stores.js';

// Fake DB ports of loads (step-1-loads T-5). They emulate what MySQL
// guarantees for `timeline_loads` and `timeline_results`: the generated
// `running_key` with `uq_timeline_loads_running_key` (one running load per
// cycle), the generated `active_key` with `uq_timeline_results_active_key` (one
// active membership per result and cycle) and `uq_timeline_results_timeline_code`
// (one membership per result and timeline, active or ended). A refused insert
// comes back as the outcome the Drizzle adapter returns for that key, and is
// counted in `violations`, so a test can tell that the database refused it.
//
// The transactional store adds the row locks of `InMemoryDatabase` and a round
// trip per statement, so transactions started together interleave at every
// statement. What each statement locks is what InnoDB locks: an INSERT takes
// the unique entry of every key it writes, in the order InnoDB checks them
// (`uq_timeline_results_timeline_code` before `uq_timeline_results_active_key`,
// as migration 0007 creates them), so an identical insert waits for the
// transaction that holds the entry and then finds its row, or none after a
// rollback; a locking read that finds nothing locks nothing (READ COMMITTED
// takes no gap lock), so the unique key is what refuses the loser. An INSERT
// also takes S on the parent row of each foreign key it writes (the cycle, the
// timeline and, for a membership, the load: migrations 0004 and 0007), which is
// what makes a lot that holds a load row and then asks for its timeline wait
// for a start that holds the timeline and asks for that load row: the lock
// cycle InnoDB answers with 1213. Nothing here detects it; a transaction caught
// in one never resumes, so a test that races them puts a time limit on it.
// Not modelled: the foreign keys to `users` and `timeline_steps`, because no
// transaction of this world locks those rows.

/** The tables a loads store reads and writes, committed or as one transaction sees them. */
export interface LoadsTables {
  loads: TimelineLoad[];
  results: TimelineResult[];
  cycles: Cycle[];
  timelines: Timeline[];
  steps: TimelineStep[];
  programs: TimelineProgram[];
  resultTypes: TimelineResultType[];
  audit: TimelineAuditEvent[];
}

/** The committed rows of loads, over the cycles and timelines of `InMemoryAdminConfigDatabase` (same row locks, same audit table). */
export class InMemoryLoadsDatabase {
  readonly loads: TimelineLoad[] = [];
  readonly results: TimelineResult[] = [];
  /** Inserts and updates the unique keys refused, by key. */
  readonly violations = { runningKey: 0, activeKey: 0, timelineCode: 0 };
  /**
   * Every write in the order the statements ran, rolled-back ones included:
   * `load:insert:1`, `load:end:1:failed`, `version:11`, `result:insert:5120@11`,
   * `result:end:7`, `progress:1`, `audit:load_start:11`.
   */
  readonly history: string[] = [];
  private issuedLoads = 0;
  private issuedResults = 0;
  readonly store: InMemoryLoadsStore;

  /** Pass a world to share its cycles, timelines, steps, row locks and idempotency rows. */
  constructor(
    readonly admin: InMemoryAdminConfigDatabase = new InMemoryAdminConfigDatabase(),
  ) {
    this.store = new InMemoryLoadsStore(this);
  }

  get tables(): LoadsTables {
    return {
      loads: this.loads,
      results: this.results,
      cycles: this.admin.cycles,
      timelines: this.admin.timelines,
      steps: this.admin.steps,
      programs: this.admin.programs,
      resultTypes: this.admin.resultTypes,
      audit: this.admin.auditEvents,
    };
  }

  /** A fresh `timeline_loads` key, unique across transactions that insert at the same time. */
  nextLoadId(): number {
    const highest = this.loads.reduce((max, l) => Math.max(max, l.id), 0);
    this.issuedLoads = Math.max(this.issuedLoads, highest) + 1;
    return this.issuedLoads;
  }

  /** A fresh `timeline_results` key, unique across transactions that insert at the same time. */
  nextResultId(): number {
    const highest = this.results.reduce((max, r) => Math.max(max, r.id), 0);
    this.issuedResults = Math.max(this.issuedResults, highest) + 1;
    return this.issuedResults;
  }
}

/** Autocommit `LoadsStore` over the committed rows (reads, seeding, inspection). */
export class InMemoryLoadsStore implements LoadsStore {
  /** Statements that read memberships (one per `findMemberships` call). */
  membershipReads = 0;

  constructor(
    protected readonly world: InMemoryLoadsDatabase,
    protected readonly t: LoadsTables = world.tables,
  ) {}

  async findMemberships(
    cycleId: number,
    resultCodes: readonly number[],
  ): Promise<CycleMembershipRow[]> {
    this.membershipReads++;
    return this.t.results
      .filter(
        (r) => r.cycleId === cycleId && resultCodes.includes(r.resultCode),
      )
      .sort((a, b) => a.id - b.id)
      .map((r) => {
        const timeline = this.t.timelines.find((x) => x.id === r.timelineId)!;
        const last = this.t.steps
          .filter((s) => s.timelineId === r.timelineId)
          .sort((a, b) => a.position - b.position)
          .at(-1)!;
        return {
          id: r.id,
          resultCode: r.resultCode,
          timelineId: r.timelineId,
          endedAt: r.endedAt,
          lastStepClosesAt: last.closesAt,
          timelineName: timeline.name,
        };
      });
  }

  private starter(load: TimelineLoad): LoadRow {
    const user = this.world.admin.base.users.find(
      (u) => u.id === load.startedBy,
    );
    return {
      load: structuredClone(load),
      startedBy: { id: load.startedBy, nickname: user?.nickname ?? null },
    };
  }

  async listByTimeline(timelineId: number): Promise<LoadRow[]> {
    return this.t.loads
      .filter((l) => l.timelineId === timelineId)
      .sort((a, b) => b.id - a.id)
      .map((l) => this.starter(l));
  }

  async findLoad(
    timelineId: number,
    loadId: number,
  ): Promise<LoadRow | undefined> {
    const row = this.t.loads.find(
      (l) => l.id === loadId && l.timelineId === timelineId,
    );
    return row && this.starter(row);
  }

  async lockCycleShared(cycleId: number): Promise<LockedCycle | undefined> {
    const row = this.t.cycles.find((c) => c.id === cycleId);
    return row && { status: row.status, year: row.year };
  }

  async findTimelineForUpdate(timelineId: number) {
    const row = this.t.timelines.find((x) => x.id === timelineId);
    return row && structuredClone(row);
  }

  async findStepOne(timelineId: number): Promise<StepOne | undefined> {
    const row = this.t.steps.find(
      (s) => s.timelineId === timelineId && s.position === 1,
    );
    return row && { id: row.id, closesAt: row.closesAt };
  }

  async findScope(timelineId: number) {
    return {
      programIds: this.t.programs
        .filter((p) => p.timelineId === timelineId)
        .map((p) => p.programId)
        .sort((a, b) => a - b),
      resultTypeKeys: this.t.resultTypes
        .filter((r) => r.timelineId === timelineId)
        .map((r) => r.resultTypeKey)
        .sort(),
    };
  }

  async lockRunningLoad(cycleId: number) {
    const row = this.t.loads.find((l) => l.runningKey === cycleId);
    return row && structuredClone(row);
  }

  async findRunningLoad(cycleId: number) {
    const row = this.t.loads.find((l) => l.runningKey === cycleId);
    return row && structuredClone(row);
  }

  async findLoadById(loadId: number) {
    const row = this.t.loads.find((l) => l.id === loadId);
    return row && structuredClone(row);
  }

  /** Autocommit: nothing to hold. */
  async lockTimelineShared(timelineId: number): Promise<void> {
    void timelineId;
  }

  async lockLoad(loadId: number) {
    const row = this.t.loads.find((l) => l.id === loadId);
    return row && structuredClone(row);
  }

  /** The generated `running_key` and its unique index: a second running load in the cycle is refused. */
  async insertLoad(values: NewLoadValues): Promise<LoadInsertOutcome> {
    if (this.t.loads.some((l) => l.runningKey === values.cycleId)) {
      this.world.violations.runningKey++;
      return { kind: 'already_running' };
    }
    const row: TimelineLoad = {
      id: this.world.nextLoadId(),
      cycleId: values.cycleId,
      timelineId: values.timelineId,
      timelineStepId: values.timelineStepId,
      phaseYear: values.phaseYear,
      scope: structuredClone(values.scope),
      status: 'running',
      runningKey: values.cycleId,
      total: null,
      processed: 0,
      summary: structuredClone({ ...values.summary }),
      failureReason: null,
      startedBy: values.startedBy,
      startedAt: values.startedAt,
      heartbeatAt: values.startedAt,
      finishedAt: null,
      requestId: values.requestId,
    };
    this.world.history.push(`load:insert:${row.id}`);
    this.t.loads.push(row);
    return { kind: 'created', loadId: row.id };
  }

  /** A conditional UPDATE on `status = 'running'`; the generated `running_key` goes NULL with the status. */
  async endLoad(loadId: number, values: LoadEndValues): Promise<boolean> {
    const row = this.t.loads.find((l) => l.id === loadId);
    if (!row || row.status !== 'running') return false;
    this.world.history.push(`load:end:${loadId}:${values.status}`);
    row.status = values.status;
    row.runningKey = null;
    row.failureReason = values.failureReason;
    row.finishedAt = values.finishedAt;
    return true;
  }

  async bumpTimelineVersion(timelineId: number): Promise<void> {
    const row = this.t.timelines.find((x) => x.id === timelineId);
    if (!row) return;
    this.world.history.push(`version:${timelineId}`);
    row.version += 1;
  }

  async insertAuditEvent(values: NewTimelineAuditEvent): Promise<void> {
    this.world.history.push(`audit:${values.action}:${values.timelineId}`);
    this.t.audit.push({
      id: this.world.admin.nextAuditEventId(),
      timelineId: values.timelineId,
      actorId: values.actorId,
      action: values.action,
      changes: structuredClone(values.changes),
      requestId: values.requestId ?? null,
      createdAt: values.createdAt ?? new Date(),
    });
  }

  /**
   * Both unique keys of `timeline_results`, in the order InnoDB checks them:
   * `(timeline_id, result_code)` first, whatever the state of the row it finds,
   * then the cycle-wide `active_key` (a new membership is always active).
   */
  async insertMembership(
    values: NewMembershipValues,
  ): Promise<MembershipInsertOutcome> {
    if (
      this.t.results.some(
        (r) =>
          r.timelineId === values.timelineId &&
          r.resultCode === values.resultCode,
      )
    ) {
      this.world.violations.timelineCode++;
      return { kind: 'duplicate', key: 'timeline_code' };
    }
    if (
      this.t.results.some(
        (r) =>
          r.activeKey === `${values.cycleId}#${values.resultCode}` &&
          r.endedAt === null,
      )
    ) {
      this.world.violations.activeKey++;
      return { kind: 'duplicate', key: 'active_key' };
    }
    const row: TimelineResult = {
      id: this.world.nextResultId(),
      cycleId: values.cycleId,
      timelineId: values.timelineId,
      loadId: values.loadId,
      resultCode: values.resultCode,
      resultId: values.resultId,
      phaseYear: values.phaseYear,
      programClarisaId: values.programClarisaId,
      resultTypeKey: values.resultTypeKey,
      status: values.status,
      kpGroup: values.kpGroup,
      awaitsStep: values.awaitsStep,
      snapshotSk: values.snapshotSk,
      snapshotHash: values.snapshotHash,
      catalogVersion: values.catalogVersion,
      createdAt: values.createdAt,
      endedAt: null,
      endReason: null,
      activeKey: `${values.cycleId}#${values.resultCode}`,
    };
    this.world.history.push(
      `result:insert:${values.resultCode}@${values.timelineId}`,
    );
    this.t.results.push(row);
    return { kind: 'created' };
  }

  async recordProgress(
    loadId: number,
    values: LoadProgressValues,
  ): Promise<void> {
    const row = this.t.loads.find((l) => l.id === loadId);
    if (!row) return;
    this.world.history.push(`progress:${loadId}`);
    row.processed = values.processed;
    row.summary = structuredClone({ ...values.summary });
    row.heartbeatAt = values.heartbeatAt;
  }

  /** A conditional UPDATE on `status = 'running'`. */
  async setTotal(loadId: number, total: number): Promise<boolean> {
    const row = this.t.loads.find((l) => l.id === loadId);
    if (!row || row.status !== 'running') return false;
    this.world.history.push(`total:${loadId}`);
    row.total = total;
    return true;
  }

  /** A conditional UPDATE on `status = 'running'`. */
  async renewHeartbeat(loadId: number, at: Date): Promise<boolean> {
    const row = this.t.loads.find((l) => l.id === loadId);
    if (!row || row.status !== 'running') return false;
    this.world.history.push(`heartbeat:${loadId}`);
    row.heartbeatAt = at;
    return true;
  }

  /** The only update a membership gets: `ended_at` and `end_reason`, on rows still active; `active_key` goes NULL. */
  async endMemberships(
    ids: readonly number[],
    endedAt: Date,
    reason: TimelineResultEndReason,
  ): Promise<number> {
    let ended = 0;
    for (const row of this.t.results) {
      if (!ids.includes(row.id) || row.endedAt !== null) continue;
      this.world.history.push(`result:end:${row.id}`);
      row.endedAt = endedAt;
      row.endReason = reason;
      row.activeKey = null;
      ended++;
    }
    return ended;
  }
}

/**
 * `LoadsStore` on one transaction's tables: statements wait a round trip and
 * take the row locks InnoDB takes, then read what is committed now (a locking
 * read or a conditional write, under READ COMMITTED every statement).
 */
export class TransactionalLoadsStore extends InMemoryLoadsStore {
  constructor(
    private readonly tx: InMemoryTransaction,
    world: InMemoryLoadsDatabase,
    tables: LoadsTables,
  ) {
    super(world, tables);
  }

  private async statement<R>(
    options: StatementOptions,
    run: () => R | Promise<R>,
  ): Promise<R> {
    await roundTrip();
    return this.tx.statement(
      { ...options, tables: Object.values(this.t) as unknown[][] },
      run,
    );
  }

  override findMemberships(cycleId: number, resultCodes: readonly number[]) {
    return this.statement({}, () =>
      super.findMemberships(cycleId, resultCodes),
    );
  }

  override listByTimeline(timelineId: number) {
    return this.statement({}, () => super.listByTimeline(timelineId));
  }

  override findLoad(timelineId: number, loadId: number) {
    return this.statement({}, () => super.findLoad(timelineId, loadId));
  }

  /** `SELECT ... FOR SHARE` of the cycle row: waits for an activation's exclusive lock, and holds the shared one to the commit. */
  override lockCycleShared(cycleId: number) {
    return this.statement(
      { current: true, locks: [[`cycles:${cycleId}`, 'S']] },
      () => super.lockCycleShared(cycleId),
    );
  }

  /** `SELECT ... FOR UPDATE`: the X lock on the timeline row (the edit's lock), held to the commit. */
  override findTimelineForUpdate(timelineId: number) {
    return this.statement(
      { current: true, locks: [[`timelines:${timelineId}`, 'X']] },
      () => super.findTimelineForUpdate(timelineId),
    );
  }

  override findStepOne(timelineId: number) {
    return this.statement({}, () => super.findStepOne(timelineId));
  }

  override findScope(timelineId: number) {
    return this.statement({}, () => super.findScope(timelineId));
  }

  /**
   * `SELECT ... WHERE running_key = ? FOR UPDATE`: finds the row, then waits for
   * its lock and judges it as committed after the wait; finding none locks
   * nothing, so two starts from "none running" are not serialized here and the
   * unique `running_key` is what refuses the second.
   */
  override async lockRunningLoad(cycleId: number) {
    for (;;) {
      const seen = await this.statement({}, () =>
        super.lockRunningLoad(cycleId),
      );
      if (!seen) return undefined;
      const locked = await this.statement(
        { current: true, locks: [[`timeline_loads:${seen.id}`, 'X']] },
        () => super.lockRunningLoad(cycleId),
      );
      if (locked?.id === seen.id) return locked;
      // It stopped running while we waited: look again.
    }
  }

  override lockLoad(loadId: number) {
    return this.statement(
      { current: true, locks: [[`timeline_loads:${loadId}`, 'X']] },
      () => super.lockLoad(loadId),
    );
  }

  /** A plain read: no lock, and the start's own snapshot rules. */
  override findRunningLoad(cycleId: number) {
    return this.statement({}, () => super.findRunningLoad(cycleId));
  }

  override findLoadById(loadId: number) {
    return this.statement({}, () => super.findLoadById(loadId));
  }

  /** `SELECT ... FROM timelines FOR SHARE`: waits for an X on the row (an edit, a start), holds S to the commit. */
  override lockTimelineShared(timelineId: number) {
    return this.statement(
      { current: true, locks: [[`timelines:${timelineId}`, 'S']] },
      () => super.lockTimelineShared(timelineId),
    );
  }

  /**
   * An INSERT takes S on the parent rows of its foreign keys (the cycle and the
   * timeline), then the unique entry of its `running_key`: a second one waits
   * for this transaction, then finds its row.
   */
  override insertLoad(values: NewLoadValues) {
    return this.statement(
      {
        current: true,
        locks: [
          [`cycles:${values.cycleId}`, 'S'],
          [`timelines:${values.timelineId}`, 'S'],
          [`timeline_loads:running:${values.cycleId}`, 'X'],
        ],
      },
      () => super.insertLoad(values),
    );
  }

  /** The UPDATE locks its row and the `running_key` entry it frees. */
  override endLoad(loadId: number, values: LoadEndValues) {
    const cycleId = this.t.loads.find((l) => l.id === loadId)?.cycleId;
    return this.statement(
      {
        current: true,
        locks: [
          [`timeline_loads:${loadId}`, 'X'],
          ...(cycleId === undefined
            ? []
            : ([[`timeline_loads:running:${cycleId}`, 'X']] as const)),
        ],
      },
      () => super.endLoad(loadId, values),
    );
  }

  override bumpTimelineVersion(timelineId: number) {
    return this.statement(
      { current: true, locks: [[`timelines:${timelineId}`, 'X']] },
      () => super.bumpTimelineVersion(timelineId),
    );
  }

  /** On the transaction's own rows: it commits or rolls back with the load. The foreign key to `timelines` takes S on that row. */
  override insertAuditEvent(values: NewTimelineAuditEvent) {
    return this.statement(
      { current: true, locks: [[`timelines:${values.timelineId}`, 'S']] },
      () => super.insertAuditEvent(values),
    );
  }

  /**
   * An INSERT takes S on the parent rows of its three foreign keys (the cycle,
   * the timeline, the load), then the unique entry of each key it writes, in
   * InnoDB's order: the timeline's own, then the cycle-wide one.
   */
  override insertMembership(values: NewMembershipValues) {
    return this.statement(
      {
        current: true,
        locks: [
          [`cycles:${values.cycleId}`, 'S'],
          [`timelines:${values.timelineId}`, 'S'],
          [`timeline_loads:${values.loadId}`, 'S'],
          [
            `timeline_results:code:${values.timelineId}:${values.resultCode}`,
            'X',
          ],
          [
            `timeline_results:active:${values.cycleId}:${values.resultCode}`,
            'X',
          ],
        ],
      },
      () => super.insertMembership(values),
    );
  }

  override recordProgress(loadId: number, values: LoadProgressValues) {
    return this.statement(
      { current: true, locks: [[`timeline_loads:${loadId}`, 'X']] },
      () => super.recordProgress(loadId, values),
    );
  }

  override setTotal(loadId: number, total: number) {
    return this.statement(
      { current: true, locks: [[`timeline_loads:${loadId}`, 'X']] },
      () => super.setTotal(loadId, total),
    );
  }

  override renewHeartbeat(loadId: number, at: Date) {
    return this.statement(
      { current: true, locks: [[`timeline_loads:${loadId}`, 'X']] },
      () => super.renewHeartbeat(loadId, at),
    );
  }

  /** The UPDATE locks each row it ends and the `active_key` entry it frees. */
  override endMemberships(
    ids: readonly number[],
    endedAt: Date,
    reason: TimelineResultEndReason,
  ) {
    const locks = this.t.results
      .filter((r) => ids.includes(r.id))
      .flatMap(
        (r) =>
          [
            [`timeline_results:${r.id}`, 'X'],
            [`timeline_results:active:${r.cycleId}:${r.resultCode}`, 'X'],
          ] as const,
      );
    return this.statement({ current: true, locks }, () =>
      super.endMemberships(ids, endedAt, reason),
    );
  }
}

/**
 * `LoadsTransactions` over `InMemoryLoadsDatabase`: commits when `work`
 * resolves, rolls back (writes dropped, locks released) when it throws. READ
 * COMMITTED by default, as the Drizzle adapter pins it. The cycle and timeline
 * row locks are the ones the timeline edit and an activation take
 * (`cycles:<id>`, `timelines:<id>`), so they serialize here as they do on
 * MySQL; the idempotency store is the users world's tx-bound one.
 */
export class InMemoryLoadsTransactions implements LoadsTransactions {
  begun = 0;
  committed = 0;
  rolledBack = 0;

  constructor(
    private readonly world: InMemoryLoadsDatabase,
    private readonly isolation: IsolationLevel = 'read committed',
  ) {}

  async run<T>(
    work: (repositories: LoadsRepositories) => Promise<T>,
  ): Promise<T> {
    this.begun++;
    const tx = this.world.admin.base.begin(this.isolation);
    try {
      const committed = this.world.tables;
      const tables: LoadsTables = {
        loads: tx.table(committed.loads, (row) => String(row.id)).rows,
        results: tx.table(committed.results, (row) => String(row.id)).rows,
        cycles: tx.table(committed.cycles, (row) => String(row.id)).rows,
        timelines: tx.table(committed.timelines, (row) => String(row.id)).rows,
        steps: tx.table(committed.steps, (row) => String(row.id)).rows,
        programs: tx.table(
          committed.programs,
          (row) => `${row.timelineId}:${row.programId}`,
        ).rows,
        resultTypes: tx.table(
          committed.resultTypes,
          (row) => `${row.timelineId}:${row.resultTypeKey}`,
        ).rows,
        audit: tx.table(committed.audit, (row) => String(row.id)).rows,
      };
      const result = await work({
        loads: new TransactionalLoadsStore(tx, this.world, tables),
        idempotency: tx.repositories().idempotency,
      });
      tx.commit();
      this.committed++;
      return result;
    } catch (error) {
      tx.rollback();
      this.rolledBack++;
      throw error;
    }
  }
}
