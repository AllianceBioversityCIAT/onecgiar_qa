import type {
  CycleSummaryRow,
  CyclesStore,
  InsertOutcome,
  ReadOptions,
  StatusChange,
} from '../../src/admin-config/cycles/cycles.store.js';
import type {
  CyclesRepositories,
  CyclesUnitOfWork,
} from '../../src/admin-config/cycles/cycles.unit-of-work.js';
import type {
  Cycle,
  CycleStatus,
  NewCycle,
} from '../../src/database/drizzle/schema/cycles.js';
import type {
  ActiveAssignmentRow,
  AssignedCountRow,
  AssignmentInsertOutcome,
  NewAssignmentValues,
  NewAuditEventValues,
  NewStepValues,
  StepUpdateValues,
  TimelineBundle,
  TimelineInsertOutcome,
  TimelineUpdateOutcome,
  TimelineUpdateValues,
  TimelinesStore,
} from '../../src/admin-config/timelines/timelines.store.js';
import type { TimelineLoads } from '../../src/admin-config/timelines/timeline-loads.js';
import type {
  TimelinesRepositories,
  TimelinesUnitOfWork,
} from '../../src/admin-config/timelines/timelines.unit-of-work.js';
import type { TimelineAuditEvent } from '../../src/database/drizzle/schema/timeline-audit-events.js';
import type { TimelineProgram } from '../../src/database/drizzle/schema/timeline-programs.js';
import type { TimelineResultType } from '../../src/database/drizzle/schema/timeline-result-types.js';
import type { TimelineStep } from '../../src/database/drizzle/schema/timeline-steps.js';
import type { TimelineUser } from '../../src/database/drizzle/schema/timeline-users.js';
import type {
  NewTimeline,
  Timeline,
} from '../../src/database/drizzle/schema/timelines.js';
import { roundTrip } from './in-memory-idempotency.js';
import {
  InMemoryDatabase,
  type InMemoryTransaction,
  type IsolationLevel,
  type StatementOptions,
} from './in-memory-stores.js';

// Fake DB ports of cycles (cycle-timelines T-5). They emulate what MySQL
// guarantees for the `cycles` table: `uq_cycles_year`, the generated
// `active_key` with `uq_cycles_active_key`, and the CHECKs `chk_cycles_year`
// and `chk_cycles_lifecycle`. A violated unique key raises MySQL's 1062 as a
// driver-shaped error; a violated CHECK raises 3819. The transactional store
// adds the row locks of `InMemoryDatabase` and a round trip per statement, so
// two transactions started together interleave at every statement and a flow
// that forgets a lock races exactly as it would on MySQL.

function duplicateKey(key: string): never {
  throw Object.assign(
    new Error(`Duplicate entry '1' for key 'cycles.${key}'`),
    { code: 'ER_DUP_ENTRY', errno: 1062 },
  );
}

function checkFailed(name: string): never {
  throw Object.assign(new Error(`Check constraint '${name}' is violated.`), {
    code: 'ER_CHECK_CONSTRAINT_VIOLATED',
    errno: 3819,
  });
}

/** `chk_cycles_year` and `chk_cycles_lifecycle` of the schema file, on the row as it would be stored. */
export function assertCycleChecks(row: Cycle): void {
  if (row.year < 2020 || row.year > 2100) checkFailed('chk_cycles_year');
  const activated = row.activatedAt !== null && row.activatedBy !== null;
  const noActivation = row.activatedAt === null && row.activatedBy === null;
  const closed = row.closedAt !== null && row.closedBy !== null;
  const noClosing = row.closedAt === null && row.closedBy === null;
  const lifecycle =
    (row.status === 'draft' && noActivation && noClosing) ||
    (row.status === 'active' && activated && noClosing) ||
    (row.status === 'closed' && closed);
  if (!lifecycle) checkFailed('chk_cycles_lifecycle');
}

/** The committed tables of cycles, over the row locks and idempotency rows of one `InMemoryDatabase`. */
export class InMemoryAdminConfigDatabase {
  readonly cycles: Cycle[] = [];
  /** The committed rows of the timeline tables; the timeline store writes them, unit tests may seed them. */
  readonly timelines: Timeline[] = [];
  readonly steps: TimelineStep[] = [];
  readonly programs: TimelineProgram[] = [];
  readonly resultTypes: TimelineResultType[] = [];
  /** The committed rows of `timeline_users`: the assign and remove routes write them, unit tests may seed them. */
  readonly assignments: TimelineUser[] = [];
  /** The committed rows of `timeline_audit_events` (timeline-edit FR-10): inserted by an applied edit, never updated or deleted. */
  readonly auditEvents: TimelineAuditEvent[] = [];
  /** `roles.id` -> `roles.code`, as the seeded `roles` table maps them for the join of the counts. */
  readonly roleCodeById = new Map<number, string>([
    [1, 'ADMIN'],
    [2, 'LEAD_ASSESSOR'],
    [3, 'ASSESSOR'],
    [4, 'TPB'],
    [5, 'PPU'],
    [6, 'PROGRAM'],
  ]);
  /**
   * Read statements the timeline store ran, in order (`timelines:cycle:1`,
   * `steps:1,2`): design 7.4 and NFR-5 count them, so a test that reads 1 and
   * then 50 timelines sees the same number.
   */
  readonly timelineReadLog: string[] = [];
  /**
   * Timeline writes in the order the statements RAN: `timeline:official:1`,
   * `programs:1`, `steps:1`. A rolled-back write stays in it, so an empty log
   * proves that no statement ran at all.
   */
  readonly timelineWriteLog: string[] = [];
  /**
   * Every write of cycles AND timelines in the order the statements ran:
   * `close:1`, `activate:2` (status writes) among `timeline:official:1`,
   * `programs:1`, `result-types:1`, `steps:1`. It is how a test sees whether two
   * transactions on the same cycle ran one after the other or interleaved: a
   * lock held to the commit leaves one transaction's writes contiguous.
   */
  readonly history: string[] = [];
  /** Read statements of the timeline tables, by any store of this world (the length of `timelineReadLog`). */
  timelineReads = 0;

  /** One timeline read statement. */
  recordTimelineRead(entry: string): void {
    this.timelineReads++;
    this.timelineReadLog.push(entry);
  }
  /** Inserts refused by `uq_timelines_official_key`: the backstop the cycle lock must keep from firing (DD-3). */
  officialKeyViolations = 0;
  /** Inserts refused by `uq_timelines_cycle_name`. */
  nameViolations = 0;
  /** Inserts refused by `uq_timeline_users_active_key`: the backstop that makes two identical assigns one row (DD-10). */
  assignmentKeyViolations = 0;
  /** Status writes in the order they were applied: `close:2`, `activate:3`. */
  readonly writeLog: string[] = [];
  readonly store: InMemoryCyclesStore;
  readonly timelineStore: InMemoryTimelinesStore;
  /** The fake `TIMELINE_LOADS` port: which timelines "have a load" is settable (timeline-edit design 7.4). */
  readonly loads: InMemoryTimelineLoads;
  private issued = 0;
  private issuedTimelines = 0;
  private issuedSteps = 0;
  private issuedAssignments = 0;
  private issuedAudit = 0;

  /** Pass the users world's database to share its row locks and idempotency rows. */
  constructor(readonly base: InMemoryDatabase = new InMemoryDatabase()) {
    this.store = new InMemoryCyclesStore(this);
    this.timelineStore = new InMemoryTimelinesStore(this);
    this.loads = new InMemoryTimelineLoads(this);
  }

  /** One timeline write: in `timelineWriteLog` and in the cross-table `history`. */
  recordTimelineWrite(entry: string): void {
    this.timelineWriteLog.push(entry);
    this.history.push(entry);
  }

  /** A fresh timeline key, unique across transactions that insert at the same time. */
  nextTimelineId(): number {
    const highest = this.timelines.reduce((max, t) => Math.max(max, t.id), 0);
    this.issuedTimelines = Math.max(this.issuedTimelines, highest) + 1;
    return this.issuedTimelines;
  }

  /** A fresh `timeline_users` key, unique across transactions that insert at the same time. */
  nextAssignmentId(): number {
    const highest = this.assignments.reduce((max, a) => Math.max(max, a.id), 0);
    this.issuedAssignments = Math.max(this.issuedAssignments, highest) + 1;
    return this.issuedAssignments;
  }

  /** A fresh `timeline_audit_events` key, unique across transactions that insert at the same time. */
  nextAuditEventId(): number {
    const highest = this.auditEvents.reduce((max, e) => Math.max(max, e.id), 0);
    this.issuedAudit = Math.max(this.issuedAudit, highest) + 1;
    return this.issuedAudit;
  }

  nextStepId(): number {
    const highest = this.steps.reduce((max, s) => Math.max(max, s.id), 0);
    this.issuedSteps = Math.max(this.issuedSteps, highest) + 1;
    return this.issuedSteps;
  }

  /** A fresh primary key, unique across transactions that insert at the same time. */
  nextCycleId(): number {
    const highest = this.cycles.reduce((max, c) => Math.max(max, c.id), 0);
    this.issued = Math.max(this.issued, highest) + 1;
    return this.issued;
  }
}

/**
 * The fake `TIMELINE_LOADS` port (timeline-edit design 7.4, DD-8). Unlike
 * `NoTimelineLoads` it is a real statement: each call is one entry of the
 * world's `timelineReadLog` (`loads:1,2`), so the NFR-5 counts of a test that
 * binds it include the loads query the P2-3905 adapter will run, and a count
 * cannot pass by skipping it. A timeline "has a load" once `markLoaded` named
 * it; nothing else sets it, as nothing else can record a load yet (P-8).
 */
export class InMemoryTimelineLoads implements TimelineLoads {
  /** Timelines that have a load. */
  readonly loaded = new Set<number>();
  /** Calls answered, one per statement. */
  calls = 0;

  constructor(private readonly world: InMemoryAdminConfigDatabase) {}

  markLoaded(...timelineIds: number[]): void {
    for (const id of timelineIds) this.loaded.add(id);
  }

  async withLoad(timelineIds: readonly number[]): Promise<ReadonlySet<number>> {
    this.calls++;
    this.world.recordTimelineRead(`loads:${timelineIds.join(',')}`);
    return new Set(timelineIds.filter((id) => this.loaded.has(id)));
  }
}

/** Autocommit `CyclesStore` over the committed rows (reads, seeding, inspection). */
export class InMemoryCyclesStore implements CyclesStore {
  writes = 0;
  /** Statements that read the list or the detail model (design 7.4: one per call). */
  queries = 0;

  constructor(
    protected readonly world: InMemoryAdminConfigDatabase,
    readonly rows: Cycle[] = world.cycles,
  ) {}

  async insert(values: NewCycle): Promise<InsertOutcome> {
    const status = values.status ?? 'draft';
    const row: Cycle = {
      id: this.world.nextCycleId(),
      year: values.year,
      status,
      activeKey: status === 'active' ? 1 : null,
      createdAt: values.createdAt ?? new Date(),
      createdBy: values.createdBy,
      activatedAt: values.activatedAt ?? null,
      activatedBy: values.activatedBy ?? null,
      closedAt: values.closedAt ?? null,
      closedBy: values.closedBy ?? null,
    };
    assertCycleChecks(row);
    if (this.rows.some((r) => r.year === row.year)) {
      return { kind: 'duplicate' }; // uq_cycles_year
    }
    if (status === 'active' && this.rows.some((r) => r.status === 'active')) {
      duplicateKey('uq_cycles_active_key');
    }
    this.writes++;
    this.rows.push(row);
    return { kind: 'created', cycle: structuredClone(row) };
  }

  async findById(id: number, _options: ReadOptions = {}) {
    const row = this.rows.find((r) => r.id === id);
    return row && structuredClone(row);
  }

  async findActive(_options: ReadOptions = {}) {
    const row = this.rows.find((r) => r.status === 'active');
    return row && structuredClone(row);
  }

  async markActive(id: number, { by, at }: StatusChange) {
    this.apply(id, 'activate', {
      status: 'active',
      activeKey: 1,
      activatedAt: at,
      activatedBy: by,
    });
  }

  async markClosed(id: number, { by, at }: StatusChange) {
    this.apply(id, 'close', {
      status: 'closed',
      activeKey: null,
      closedAt: at,
      closedBy: by,
    });
  }

  /** An UPDATE of one row: CHECKs on the new row, then the unique `active_key`. */
  private apply(id: number, op: 'activate' | 'close', patch: Partial<Cycle>) {
    const row = this.rows.find((r) => r.id === id);
    if (!row) throw new Error(`No cycle ${id}`);
    const next = { ...row, ...patch };
    assertCycleChecks(next);
    if (
      next.status === 'active' &&
      this.rows.some((r) => r.id !== id && r.status === 'active')
    ) {
      duplicateKey('uq_cycles_active_key');
    }
    this.writes++;
    this.world.writeLog.push(`${op}:${id}`);
    this.world.history.push(`${op}:${id}`);
    Object.assign(row, next);
  }

  private summary(row: Cycle): CycleSummaryRow {
    const own = this.world.timelines.filter((t) => t.cycleId === row.id);
    const steps = this.world.steps.filter((s) =>
      own.some((t) => t.id === s.timelineId),
    );
    return {
      id: row.id,
      year: row.year,
      status: row.status,
      createdAt: row.createdAt,
      timelineCount: own.length,
      startsOn: steps.map((s) => s.opensAt).sort()[0] ?? null,
      endsOn:
        steps
          .map((s) => s.closesAt)
          .sort()
          .at(-1) ?? null,
    };
  }

  async listSummaries() {
    this.queries++;
    return [...this.rows]
      .sort((a, b) => b.year - a.year)
      .map((row) => this.summary(row));
  }

  async findSummary(id: number) {
    this.queries++;
    const row = this.rows.find((r) => r.id === id);
    return row && this.summary(row);
  }
}

/**
 * `CyclesStore` inside one transaction: every statement waits a round trip,
 * takes its row locks first (they may wait for another transaction), then
 * reads what is committed now. What each locks is what InnoDB locks:
 * - an INSERT of a taken year waits for the transaction holding that unique
 *   entry, then finds its row (or none, after a rollback);
 * - `findById(forUpdate)` locks the cycle row;
 * - `findActive(forUpdate)` waits for the active row, then judges it as
 *   committed after the wait; with no active row it locks nothing (READ
 *   COMMITTED takes no gap lock), so two activations from "none active" are
 *   not serialized and the unique `active_key` is the backstop;
 * - an UPDATE locks its row, and one that makes a row active also takes the
 *   unique `active_key` entry, so it waits for another activation's commit.
 */
export class TransactionalCyclesStore extends InMemoryCyclesStore {
  constructor(
    private readonly tx: InMemoryTransaction,
    world: InMemoryAdminConfigDatabase,
    rows: Cycle[],
  ) {
    super(world, rows);
  }

  private async statement<R>(
    options: StatementOptions,
    run: () => R | Promise<R>,
  ): Promise<R> {
    await roundTrip();
    return this.tx.statement({ ...options, tables: [this.rows] }, run);
  }

  override insert(values: NewCycle) {
    return this.statement(
      { current: true, locks: [[`cycles:year:${values.year}`, 'X']] },
      () => super.insert(values),
    );
  }

  override findById(id: number, options: ReadOptions = {}) {
    return options.forUpdate
      ? this.statement({ current: true, locks: [[`cycles:${id}`, 'X']] }, () =>
          super.findById(id),
        )
      : this.statement({}, () => super.findById(id));
  }

  override async findActive(options: ReadOptions = {}) {
    if (!options.forUpdate) return this.statement({}, () => super.findActive());
    for (;;) {
      const seen = await this.statement({}, () => super.findActive());
      if (!seen) return undefined;
      const locked = await this.statement(
        { current: true, locks: [[`cycles:${seen.id}`, 'X']] },
        () => super.findActive(),
      );
      if (locked?.id === seen.id) return locked;
      // It stopped being active while we waited: look again.
    }
  }

  override markActive(id: number, change: StatusChange) {
    return this.statement(
      {
        current: true,
        locks: [
          [`cycles:${id}`, 'X'],
          ['cycles:active_key', 'X'],
        ],
      },
      () => super.markActive(id, change),
    );
  }

  override markClosed(id: number, change: StatusChange) {
    return this.statement(
      { current: true, locks: [[`cycles:${id}`, 'X']] },
      () => super.markClosed(id, change),
    );
  }
}

/**
 * `CyclesUnitOfWork` over `InMemoryAdminConfigDatabase`: commits when `work`
 * resolves, rolls back (writes dropped, locks released) when it throws. READ
 * COMMITTED by default, as the Drizzle unit of work pins it. The idempotency
 * store is the users world's tx-bound one: same rows, same row locks.
 */
export class InMemoryCyclesUnitOfWork implements CyclesUnitOfWork {
  begun = 0;
  committed = 0;
  rolledBack = 0;

  constructor(
    private readonly world: InMemoryAdminConfigDatabase,
    private readonly isolation: IsolationLevel = 'read committed',
  ) {}

  async run<T>(
    work: (repositories: CyclesRepositories) => Promise<T>,
  ): Promise<T> {
    this.begun++;
    const tx = this.world.base.begin(this.isolation);
    try {
      const table = tx.table(this.world.cycles, (row) => String(row.id));
      const result = await work({
        cycles: new TransactionalCyclesStore(tx, this.world, table.rows),
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

// --- timelines (cycle-timelines T-6) ----------------------------------------

function duplicateEntry(key: string): never {
  throw Object.assign(new Error(`Duplicate entry for key '${key}'`), {
    code: 'ER_DUP_ENTRY',
    errno: 1062,
  });
}

/** `utf8mb4_0900_ai_ci`: names that differ only in case or accents are the same name (FR-6). */
export function collateName(name: string): string {
  return name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** The CHECKs of `timeline_steps` that one row can break (schema file), on the row as it would be stored. */
function assertStepChecks(step: NewStepValues): void {
  if (step.position < 1 || step.position > 5) {
    checkFailed('chk_timeline_steps_position');
  }
  if (step.closesAt < step.opensAt) checkFailed('chk_timeline_steps_dates');
  if (step.round < 1) checkFailed('chk_timeline_steps_round');
  if (step.position === 1 && !step.requiresLoad) {
    checkFailed('chk_timeline_steps_first_load');
  }
}

/**
 * Autocommit `TimelinesStore` over the committed rows (reads, seeding,
 * inspection). It emulates what MySQL guarantees for the timeline tables:
 * `uq_timelines_cycle_name` (case- and accent-insensitive), the generated
 * `official_key` with `uq_timelines_official_key`, the step CHECKs, the unique
 * position and audience of a step, and the primary keys of the scope tables. The
 * two keys a create can hit come back as outcomes, as the Drizzle adapter
 * returns them; the others raise 1062 / 3819 as the driver does.
 */
export class InMemoryTimelinesStore implements TimelinesStore {
  constructor(
    protected readonly world: InMemoryAdminConfigDatabase,
    readonly rows: Timeline[] = world.timelines,
    readonly stepRows: TimelineStep[] = world.steps,
    readonly programRows: TimelineProgram[] = world.programs,
    readonly resultTypeRows: TimelineResultType[] = world.resultTypes,
    readonly assignmentRows: TimelineUser[] = world.assignments,
    readonly auditRows: TimelineAuditEvent[] = world.auditEvents,
  ) {}

  async insert(values: NewTimeline): Promise<TimelineInsertOutcome> {
    const row: Timeline = {
      id: this.world.nextTimelineId(),
      cycleId: values.cycleId,
      name: values.name,
      kind: values.kind,
      officialKey: values.kind === 'official' ? values.cycleId : null,
      allPrograms: values.allPrograms,
      allResultTypes: values.allResultTypes,
      createdAt: values.createdAt ?? new Date(),
      createdBy: values.createdBy,
      // As the column defaults give a new row (timeline-edit FR-9, FR-10).
      version: 1,
      updatedAt: null,
      updatedBy: null,
    };
    // InnoDB reports the first unique index that refuses the row, in the order
    // the table declares them: the name, then the official key.
    if (
      this.rows.some(
        (r) =>
          r.cycleId === row.cycleId &&
          collateName(r.name) === collateName(row.name),
      )
    ) {
      this.world.nameViolations++;
      return { kind: 'name_taken' };
    }
    if (
      row.officialKey !== null &&
      this.rows.some((r) => r.officialKey === row.officialKey)
    ) {
      this.world.officialKeyViolations++;
      return { kind: 'official_taken' };
    }
    this.world.recordTimelineWrite(`timeline:${row.kind}:${row.id}`);
    this.rows.push(row);
    return { kind: 'created', timelineId: row.id };
  }

  async hasOfficial(cycleId: number): Promise<boolean> {
    return this.rows.some((r) => r.officialKey === cycleId);
  }

  async insertPrograms(timelineId: number, programIds: readonly number[]) {
    for (const programId of programIds) {
      if (
        this.programRows.some(
          (r) => r.timelineId === timelineId && r.programId === programId,
        )
      ) {
        duplicateEntry('timeline_programs.PRIMARY');
      }
      this.programRows.push({ timelineId, programId });
    }
    this.world.recordTimelineWrite(`programs:${timelineId}`);
  }

  async insertResultTypes(
    timelineId: number,
    resultTypeKeys: readonly string[],
  ) {
    for (const resultTypeKey of resultTypeKeys) {
      if (
        this.resultTypeRows.some(
          (r) =>
            r.timelineId === timelineId && r.resultTypeKey === resultTypeKey,
        )
      ) {
        duplicateEntry('timeline_result_types.PRIMARY');
      }
      this.resultTypeRows.push({ timelineId, resultTypeKey });
    }
    this.world.recordTimelineWrite(`result-types:${timelineId}`);
  }

  async insertSteps(timelineId: number, steps: readonly NewStepValues[]) {
    for (const step of steps) {
      assertStepChecks(step);
      const own = this.stepRows.filter((r) => r.timelineId === timelineId);
      if (own.some((r) => r.position === step.position)) {
        duplicateEntry('timeline_steps.uq_timeline_steps_position');
      }
      if (own.some((r) => r.audience === step.audience)) {
        duplicateEntry('timeline_steps.uq_timeline_steps_audience');
      }
      this.stepRows.push({
        id: this.world.nextStepId(),
        timelineId,
        position: step.position,
        name: step.name,
        audience: step.audience,
        opensAt: step.opensAt,
        closesAt: step.closesAt,
        round: step.round,
        requiresLoad: step.requiresLoad,
      });
    }
    this.world.recordTimelineWrite(`steps:${timelineId}`);
  }

  async findById(id: number): Promise<Timeline | undefined> {
    this.world.recordTimelineRead(`timeline:${id}`);
    return structuredClone(this.rows.find((r) => r.id === id));
  }

  async cycleExists(cycleId: number): Promise<boolean> {
    this.world.recordTimelineRead(`cycle:${cycleId}`);
    return this.world.cycles.some((c) => c.id === cycleId);
  }

  async listByCycle(cycleId: number): Promise<Timeline[]> {
    this.world.recordTimelineRead(`timelines:cycle:${cycleId}`);
    return structuredClone(this.rows.filter((r) => r.cycleId === cycleId));
  }

  async listSteps(timelineIds: readonly number[]): Promise<TimelineStep[]> {
    this.world.recordTimelineRead(`steps:${timelineIds.join(',')}`);
    return structuredClone(
      this.stepRows
        .filter((r) => timelineIds.includes(r.timelineId))
        .sort((a, b) => a.position - b.position),
    );
  }

  async listPrograms(
    timelineIds: readonly number[],
  ): Promise<TimelineProgram[]> {
    this.world.recordTimelineRead(`programs:${timelineIds.join(',')}`);
    return structuredClone(
      this.programRows.filter((r) => timelineIds.includes(r.timelineId)),
    );
  }

  async listResultTypes(
    timelineIds: readonly number[],
  ): Promise<TimelineResultType[]> {
    this.world.recordTimelineRead(`result-types:${timelineIds.join(',')}`);
    return structuredClone(
      this.resultTypeRows.filter((r) => timelineIds.includes(r.timelineId)),
    );
  }

  async countAssigned(
    timelineIds: readonly number[],
  ): Promise<AssignedCountRow[]> {
    this.world.recordTimelineRead(`assigned:${timelineIds.join(',')}`);
    const counts = new Map<string, AssignedCountRow>();
    for (const row of this.assignmentRows) {
      if (row.removedAt !== null || !timelineIds.includes(row.timelineId)) {
        continue;
      }
      const roleCode = this.world.roleCodeById.get(row.roleId) ?? '?';
      const key = `${row.timelineId}:${roleCode}`;
      const entry = counts.get(key) ?? {
        timelineId: row.timelineId,
        roleCode,
        count: 0,
      };
      entry.count++;
      counts.set(key, entry);
    }
    return [...counts.values()];
  }

  async listActiveAssignments(
    timelineId: number,
  ): Promise<ActiveAssignmentRow[]> {
    this.world.recordTimelineRead(`users:${timelineId}`);
    // INNER JOIN users, INNER JOIN roles: a row without its user or role is not listed.
    return structuredClone(
      this.assignmentRows
        .filter((r) => r.timelineId === timelineId && r.removedAt === null)
        .sort(
          (a, b) =>
            a.assignedAt.getTime() - b.assignedAt.getTime() || a.id - b.id,
        )
        .flatMap((r) => {
          const user = this.world.base.users.find((u) => u.id === r.userId);
          const roleCode = this.world.roleCodeById.get(r.roleId);
          if (!user || roleCode === undefined) return [];
          return [
            {
              assignmentId: r.id,
              userId: user.id,
              firstName: user.firstName,
              lastName: user.lastName,
              email: user.email,
              roleCode,
              assignedAt: r.assignedAt,
            },
          ];
        }),
    );
  }

  async lockCycleShared(cycleId: number): Promise<CycleStatus | undefined> {
    this.world.recordTimelineRead(`cycle-status:${cycleId}`);
    return this.world.cycles.find((c) => c.id === cycleId)?.status;
  }

  async findRoleId(roleCode: string): Promise<number | undefined> {
    this.world.recordTimelineRead(`role:${roleCode}`);
    for (const [id, code] of this.world.roleCodeById) {
      if (code === roleCode) return id;
    }
    return undefined;
  }

  /**
   * `uq_timeline_users_active_key`: the stored `active_key` is
   * `timeline:user:role` while `removed_at` is NULL, NULL once removed, so a
   * removed row never refuses a new one. The key is derived from the columns
   * here, so a seeded row counts too.
   */
  async insertAssignment(
    values: NewAssignmentValues,
  ): Promise<AssignmentInsertOutcome> {
    const key = `${values.timelineId}:${values.userId}:${values.roleId}`;
    const taken = this.assignmentRows.some(
      (r) =>
        r.removedAt === null &&
        `${r.timelineId}:${r.userId}:${r.roleId}` === key,
    );
    if (taken) {
      this.world.assignmentKeyViolations++;
      return { kind: 'duplicate' };
    }
    const row: TimelineUser = {
      id: this.world.nextAssignmentId(),
      timelineId: values.timelineId,
      userId: values.userId,
      roleId: values.roleId,
      // `assigned_at` is a `datetime` without fractions: MySQL rounds a value
      // with milliseconds to the nearest second when it stores it.
      assignedAt: new Date(
        Math.round(values.assignedAt.getTime() / 1000) * 1000,
      ),
      assignedBy: values.assignedBy,
      removedAt: null,
      removedBy: null,
      activeKey: key,
    };
    this.world.recordTimelineWrite(`assign:${row.id}`);
    this.assignmentRows.push(row);
    return { kind: 'created', assignmentId: row.id };
  }

  async findActiveAssignment(
    timelineId: number,
    userId: number,
    roleId: number,
  ): Promise<TimelineUser | undefined> {
    this.world.recordTimelineRead(
      `assignment:${timelineId}:${userId}:${roleId}`,
    );
    return structuredClone(
      this.assignmentRows.find(
        (r) =>
          r.timelineId === timelineId &&
          r.userId === userId &&
          r.roleId === roleId &&
          r.removedAt === null,
      ),
    );
  }

  /** A removal keeps the row: only `removed_at`, `removed_by` and the generated key change (FR-15). */
  async removeAssignment(change: {
    timelineId: number;
    assignmentId: number;
    removedAt: Date;
    removedBy: number;
  }): Promise<boolean> {
    const row = this.assignmentRows.find(
      (r) =>
        r.id === change.assignmentId &&
        r.timelineId === change.timelineId &&
        r.removedAt === null,
    );
    if (!row) return false;
    row.removedAt = change.removedAt;
    row.removedBy = change.removedBy;
    row.activeKey = null;
    this.world.recordTimelineWrite(`remove:${row.id}`);
    return true;
  }

  /** Four statements, the row first, as the adapter reads it, so a test counts them in the read log. */
  async findBundle(id: number): Promise<TimelineBundle | undefined> {
    const timeline = await this.findById(id);
    if (!timeline) return undefined;
    const steps = await this.listSteps([id]);
    const programs = await this.listPrograms([id]);
    const resultTypes = await this.listResultTypes([id]);
    return {
      timeline,
      steps,
      programIds: programs.map((row) => row.programId),
      resultTypeKeys: resultTypes.map((row) => row.resultTypeKey),
    };
  }

  async findForUpdate(id: number): Promise<Timeline | undefined> {
    this.world.recordTimelineRead(`timeline:${id}:for-update`);
    return structuredClone(this.rows.find((r) => r.id === id));
  }

  /**
   * `UPDATE ... WHERE id = ? AND version = ?`: the version is judged on the row
   * as it is NOW, so a transaction that waited for another one's lock sees that
   * one's commit (timeline-edit DD-6). The name key is checked after the WHERE,
   * as InnoDB checks a unique index only for a row the UPDATE matched, and
   * refuses the whole statement: nothing of it is applied.
   */
  async updateTimeline(
    id: number,
    expectedVersion: number,
    values: TimelineUpdateValues,
  ): Promise<TimelineUpdateOutcome> {
    const row = this.rows.find(
      (r) => r.id === id && r.version === expectedVersion,
    );
    if (!row) return { kind: 'stale' };
    const { name } = values;
    if (
      name !== undefined &&
      this.rows.some(
        (r) =>
          r.id !== id &&
          r.cycleId === row.cycleId &&
          collateName(r.name) === collateName(name),
      )
    ) {
      this.world.nameViolations++;
      return { kind: 'name_taken' };
    }
    if (name !== undefined) row.name = name;
    if (values.allPrograms !== undefined) row.allPrograms = values.allPrograms;
    if (values.allResultTypes !== undefined) {
      row.allResultTypes = values.allResultTypes;
    }
    row.version += 1;
    row.updatedAt = values.updatedAt;
    row.updatedBy = values.updatedBy;
    this.world.recordTimelineWrite(`timeline:update:${id}`);
    return { kind: 'updated' };
  }

  /** The step's CHECKs are judged on the row as it would be stored, before anything changes. */
  async updateStep(
    timelineId: number,
    position: number,
    values: StepUpdateValues,
  ): Promise<boolean> {
    const row = this.stepRows.find(
      (r) => r.timelineId === timelineId && r.position === position,
    );
    if (!row) return false;
    const next = { ...row };
    if (values.name !== undefined) next.name = values.name;
    if (values.opensAt !== undefined) next.opensAt = values.opensAt;
    if (values.closesAt !== undefined) next.closesAt = values.closesAt;
    assertStepChecks(next);
    Object.assign(row, next);
    this.world.recordTimelineWrite(`step:update:${timelineId}:${position}`);
    return true;
  }

  /** DELETE, then INSERT (none for an empty list), as two statements like the adapter. */
  async replacePrograms(timelineId: number, programIds: readonly number[]) {
    await this.removePrograms(timelineId);
    if (programIds.length > 0)
      await this.insertPrograms(timelineId, programIds);
  }

  async replaceResultTypes(
    timelineId: number,
    resultTypeKeys: readonly string[],
  ) {
    await this.removeResultTypes(timelineId);
    if (resultTypeKeys.length > 0) {
      await this.insertResultTypes(timelineId, resultTypeKeys);
    }
  }

  protected async removePrograms(timelineId: number): Promise<void> {
    for (let i = this.programRows.length - 1; i >= 0; i--) {
      if (this.programRows[i]!.timelineId === timelineId) {
        this.programRows.splice(i, 1);
      }
    }
    this.world.recordTimelineWrite(`programs:delete:${timelineId}`);
  }

  protected async removeResultTypes(timelineId: number): Promise<void> {
    for (let i = this.resultTypeRows.length - 1; i >= 0; i--) {
      if (this.resultTypeRows[i]!.timelineId === timelineId) {
        this.resultTypeRows.splice(i, 1);
      }
    }
    this.world.recordTimelineWrite(`result-types:delete:${timelineId}`);
  }

  async insertAuditEvent(values: NewAuditEventValues): Promise<void> {
    this.auditRows.push({
      id: this.world.nextAuditEventId(),
      timelineId: values.timelineId,
      actorId: values.actorId,
      action: values.action,
      changes: structuredClone(values.changes),
      requestId: values.requestId,
      createdAt: values.createdAt,
    });
    this.world.recordTimelineWrite(`audit:${values.timelineId}`);
  }
}

/**
 * `TimelinesStore` inside one transaction: every statement waits a round trip,
 * takes its row locks first (they may wait for another transaction), then reads
 * what is committed now. What each locks is what InnoDB locks: an INSERT of a
 * timeline takes the unique entries of its name and, for an official one, of
 * `official_key`, so it waits for the transaction that holds the same entry and
 * then finds that transaction's row (or none, after a rollback).
 */
class TransactionalTimelinesStore extends InMemoryTimelinesStore {
  constructor(
    private readonly tx: InMemoryTransaction,
    world: InMemoryAdminConfigDatabase,
    rows: Timeline[],
    stepRows: TimelineStep[],
    programRows: TimelineProgram[],
    resultTypeRows: TimelineResultType[],
    assignmentRows: TimelineUser[],
    auditRows: TimelineAuditEvent[],
  ) {
    super(
      world,
      rows,
      stepRows,
      programRows,
      resultTypeRows,
      assignmentRows,
      auditRows,
    );
  }

  private async statement<R>(
    options: StatementOptions,
    run: () => R | Promise<R>,
  ): Promise<R> {
    await roundTrip();
    return this.tx.statement(
      {
        ...options,
        tables: [
          this.rows,
          this.stepRows,
          this.programRows,
          this.resultTypeRows,
          this.assignmentRows,
          this.auditRows,
        ],
      },
      run,
    );
  }

  override insert(values: NewTimeline) {
    const name = [
      `timelines:name:${values.cycleId}:${collateName(values.name)}`,
      'X',
    ] as const;
    const official = [`timelines:official:${values.cycleId}`, 'X'] as const;
    return this.statement(
      {
        current: true,
        locks: values.kind === 'official' ? [name, official] : [name],
      },
      () => super.insert(values),
    );
  }

  override hasOfficial(cycleId: number) {
    return this.statement({}, () => super.hasOfficial(cycleId));
  }

  override insertPrograms(timelineId: number, programIds: readonly number[]) {
    return this.statement({ current: true }, () =>
      super.insertPrograms(timelineId, programIds),
    );
  }

  override insertResultTypes(
    timelineId: number,
    resultTypeKeys: readonly string[],
  ) {
    return this.statement({ current: true }, () =>
      super.insertResultTypes(timelineId, resultTypeKeys),
    );
  }

  override insertSteps(timelineId: number, steps: readonly NewStepValues[]) {
    return this.statement({ current: true }, () =>
      super.insertSteps(timelineId, steps),
    );
  }

  override findById(id: number) {
    return this.statement({}, () => super.findById(id));
  }

  /** `SELECT ... FOR SHARE` of the cycle row: waits for an activation's exclusive lock, and holds the shared one to the commit. */
  override lockCycleShared(cycleId: number) {
    return this.statement(
      { current: true, locks: [[`cycles:${cycleId}`, 'S']] },
      () => super.lockCycleShared(cycleId),
    );
  }

  override findRoleId(roleCode: string) {
    return this.statement({}, () => super.findRoleId(roleCode));
  }

  /** An INSERT takes the unique entry of its `active_key`: an identical one waits for this transaction, then finds its row. */
  override insertAssignment(values: NewAssignmentValues) {
    return this.statement(
      {
        current: true,
        locks: [
          [
            `timeline_users:active:${values.timelineId}:${values.userId}:${values.roleId}`,
            'X',
          ],
        ],
      },
      () => super.insertAssignment(values),
    );
  }

  override findActiveAssignment(
    timelineId: number,
    userId: number,
    roleId: number,
  ) {
    return this.statement({ current: true }, () =>
      super.findActiveAssignment(timelineId, userId, roleId),
    );
  }

  /** The UPDATE locks the row it changes; a second removal waits, then finds `removed_at` set and matches nothing. */
  override removeAssignment(change: {
    timelineId: number;
    assignmentId: number;
    removedAt: Date;
    removedBy: number;
  }) {
    return this.statement(
      {
        current: true,
        locks: [[`timeline_users:${change.assignmentId}`, 'X']],
      },
      () => super.removeAssignment(change),
    );
  }

  /** `SELECT ... FOR UPDATE`: the X lock on the timeline row, held to the commit; a second one waits and then reads what the first committed. */
  override findForUpdate(id: number) {
    return this.statement(
      { current: true, locks: [[`timelines:${id}`, 'X']] },
      () => super.findForUpdate(id),
    );
  }

  /**
   * The UPDATE locks its row (`timelines:<id>`) and, when it writes a name, the
   * unique entry of that name (the one an INSERT takes), so a rename and a
   * create of one name serialize. The version is checked AFTER the locks, on
   * what is committed now (design 7.3, DD-6).
   */
  override updateTimeline(
    id: number,
    expectedVersion: number,
    values: TimelineUpdateValues,
  ) {
    const cycleId = this.rows.find((r) => r.id === id)?.cycleId;
    const locks: Array<readonly [string, 'S' | 'X']> = [
      [`timelines:${id}`, 'X'],
    ];
    if (values.name !== undefined && cycleId !== undefined) {
      locks.push([
        `timelines:name:${cycleId}:${collateName(values.name)}`,
        'X',
      ]);
    }
    return this.statement({ current: true, locks }, () =>
      super.updateTimeline(id, expectedVersion, values),
    );
  }

  override updateStep(
    timelineId: number,
    position: number,
    values: StepUpdateValues,
  ) {
    return this.statement(
      {
        current: true,
        locks: [[`timeline_steps:${timelineId}:${position}`, 'X']],
      },
      () => super.updateStep(timelineId, position, values),
    );
  }

  protected override removePrograms(timelineId: number) {
    return this.statement({ current: true }, () =>
      super.removePrograms(timelineId),
    );
  }

  protected override removeResultTypes(timelineId: number) {
    return this.statement({ current: true }, () =>
      super.removeResultTypes(timelineId),
    );
  }

  /** On the transaction's own rows: it commits or rolls back with the edit (FR-10). */
  override insertAuditEvent(values: NewAuditEventValues) {
    return this.statement({ current: true }, () =>
      super.insertAuditEvent(values),
    );
  }
}

/**
 * `TimelinesUnitOfWork` over `InMemoryAdminConfigDatabase`: commits when `work`
 * resolves, rolls back (writes dropped, locks released) when it throws. READ
 * COMMITTED by default, as the Drizzle unit of work pins it. The cycle row lock
 * is the one an activation takes (`cycles:<id>`), so the two serialize here as
 * they do on MySQL; the idempotency store is the users world's tx-bound one.
 */
export class InMemoryTimelinesUnitOfWork implements TimelinesUnitOfWork {
  begun = 0;
  committed = 0;
  rolledBack = 0;

  constructor(
    private readonly world: InMemoryAdminConfigDatabase,
    private readonly isolation: IsolationLevel = 'read committed',
  ) {}

  async run<T>(
    work: (repositories: TimelinesRepositories) => Promise<T>,
  ): Promise<T> {
    this.begun++;
    const tx = this.world.base.begin(this.isolation);
    try {
      const cycles = tx.table(this.world.cycles, (row) => String(row.id));
      const timelines = tx.table(this.world.timelines, (row) => String(row.id));
      const steps = tx.table(this.world.steps, (row) => String(row.id));
      const programs = tx.table(
        this.world.programs,
        (row) => `${row.timelineId}:${row.programId}`,
      );
      const resultTypes = tx.table(
        this.world.resultTypes,
        (row) => `${row.timelineId}:${row.resultTypeKey}`,
      );
      const assignments = tx.table(this.world.assignments, (row) =>
        String(row.id),
      );
      const audit = tx.table(this.world.auditEvents, (row) => String(row.id));
      // The users world's repositories, tx-bound: the user and her grants an
      // assign reads are rows of this transaction, as on the Drizzle unit of work.
      const base = tx.repositories();
      const result = await work({
        cycles: new TransactionalCyclesStore(tx, this.world, cycles.rows),
        timelines: new TransactionalTimelinesStore(
          tx,
          this.world,
          timelines.rows,
          steps.rows,
          programs.rows,
          resultTypes.rows,
          assignments.rows,
          audit.rows,
        ),
        users: base.users,
        grants: base.assignments,
        idempotency: base.idempotency,
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
