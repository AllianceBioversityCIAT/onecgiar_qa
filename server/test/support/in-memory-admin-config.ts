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
  NewCycle,
} from '../../src/database/drizzle/schema/cycles.js';
import type { TimelineStep } from '../../src/database/drizzle/schema/timeline-steps.js';
import type { Timeline } from '../../src/database/drizzle/schema/timelines.js';
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
  /** Seeded directly by the unit tests (the timelines routes arrive with T-6). */
  readonly timelines: Timeline[] = [];
  readonly steps: TimelineStep[] = [];
  /** Status writes in the order they were applied: `close:2`, `activate:3`. */
  readonly writeLog: string[] = [];
  readonly store: InMemoryCyclesStore;
  private issued = 0;

  /** Pass the users world's database to share its row locks and idempotency rows. */
  constructor(readonly base: InMemoryDatabase = new InMemoryDatabase()) {
    this.store = new InMemoryCyclesStore(this);
  }

  /** A fresh primary key, unique across transactions that insert at the same time. */
  nextCycleId(): number {
    const highest = this.cycles.reduce((max, c) => Math.max(max, c.id), 0);
    this.issued = Math.max(this.issued, highest) + 1;
    return this.issued;
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
      startsOn: steps.map((s) => s.opensOn).sort()[0] ?? null,
      endsOn:
        steps
          .map((s) => s.closesOn)
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
class TransactionalCyclesStore extends InMemoryCyclesStore {
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
