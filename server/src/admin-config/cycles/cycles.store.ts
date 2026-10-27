import { Inject, Injectable } from '@nestjs/common';
import { countDistinct, desc, eq, max, min } from 'drizzle-orm';
import { DRIZZLE } from '../../database/drizzle/drizzle.constants.js';
import type { DrizzleDB } from '../../database/drizzle/drizzle.module.js';
import {
  cycles,
  type Cycle,
  type CycleStatus,
  type NewCycle,
} from '../../database/drizzle/schema/cycles.js';
import { timelineSteps } from '../../database/drizzle/schema/timeline-steps.js';
import { timelines } from '../../database/drizzle/schema/timelines.js';
import { isDuplicateKeyError } from '../../users/users.errors.js';

export const CYCLES_STORE = Symbol('CYCLES_STORE');

export interface ReadOptions {
  /** `SELECT ... FOR UPDATE`: the row stays locked until the transaction ends. */
  forUpdate?: boolean;
}

/** Who changed a cycle's status, and when (read from the injectable clock, NFR-4). */
export interface StatusChange {
  by: number;
  at: Date;
}

/** One row of the cycle list: the cycle and what its timelines add up to (FR-2). */
export interface CycleSummaryRow {
  id: number;
  year: number;
  status: CycleStatus;
  createdAt: Date;
  timelineCount: number;
  startsOn: string | null;
  endsOn: string | null;
}

export type InsertOutcome =
  { kind: 'created'; cycle: Cycle } | { kind: 'duplicate' };

/** The persistence port of cycles (design 3, 6, 7.3). Rules live in `CyclesService`. */
export interface CyclesStore {
  /** `INSERT`; a taken year (`uq_cycles_year`, MySQL 1062) is `duplicate`. */
  insert(values: NewCycle): Promise<InsertOutcome>;
  findById(id: number, options?: ReadOptions): Promise<Cycle | undefined>;
  /**
   * The active cycle, found through `uq_cycles_active_key`; `undefined` when
   * none is active. With `forUpdate` it waits for a transaction that holds the
   * row and answers what is committed after the wait.
   */
  findActive(options?: ReadOptions): Promise<Cycle | undefined>;
  /** `draft` → `active`. A second active row is refused by the database (1062). */
  markActive(id: number, change: StatusChange): Promise<void>;
  /** `active` → `closed`; the cycle keeps its own activation data. */
  markClosed(id: number, change: StatusChange): Promise<void>;
  /** Every cycle with its timeline count and date range, newest year first, in ONE statement (design 7.4). */
  listSummaries(): Promise<CycleSummaryRow[]>;
  findSummary(id: number): Promise<CycleSummaryRow | undefined>;
}

type CyclesDb = Pick<DrizzleDB, 'select' | 'insert' | 'update'>;

/** Drizzle adapter of `CyclesStore`. `db` is the pool for reads or a transaction handle (`DrizzleCyclesUnitOfWork`). */
@Injectable()
export class DrizzleCyclesStore implements CyclesStore {
  constructor(@Inject(DRIZZLE) private readonly db: CyclesDb) {}

  async insert(values: NewCycle): Promise<InsertOutcome> {
    try {
      const [header] = await this.db.insert(cycles).values(values);
      const cycle = await this.findById(header.insertId);
      if (!cycle) throw new Error('Inserted cycle could not be read back');
      return { kind: 'created', cycle };
    } catch (error) {
      if (isDuplicateKeyError(error)) return { kind: 'duplicate' };
      throw error;
    }
  }

  async findById(id: number, options: ReadOptions = {}) {
    const query = this.db
      .select()
      .from(cycles)
      .where(eq(cycles.id, id))
      .limit(1);
    const [row] = await (options.forUpdate ? query.for('update') : query);
    return row;
  }

  async findActive(options: ReadOptions = {}) {
    // Through the unique index on `active_key`, so a locking read touches the
    // active row alone: a scan over `status` would also wait for the rows other
    // activations hold as their targets, and two of them could wait for each
    // other.
    const query = this.db
      .select()
      .from(cycles)
      .where(eq(cycles.activeKey, 1))
      .limit(1);
    const [row] = await (options.forUpdate ? query.for('update') : query);
    return row;
  }

  async markActive(id: number, { by, at }: StatusChange) {
    await this.db
      .update(cycles)
      .set({ status: 'active', activatedAt: at, activatedBy: by })
      .where(eq(cycles.id, id));
  }

  async markClosed(id: number, { by, at }: StatusChange) {
    await this.db
      .update(cycles)
      .set({ status: 'closed', closedAt: at, closedBy: by })
      .where(eq(cycles.id, id));
  }

  /** One grouped query over cycles left-joined with their timelines and steps (design 7.4, NFR-5). */
  private summaries() {
    return this.db
      .select({
        id: cycles.id,
        year: cycles.year,
        status: cycles.status,
        createdAt: cycles.createdAt,
        timelineCount: countDistinct(timelines.id),
        startsOn: min(timelineSteps.opensAt),
        endsOn: max(timelineSteps.closesAt),
      })
      .from(cycles)
      .leftJoin(timelines, eq(timelines.cycleId, cycles.id))
      .leftJoin(timelineSteps, eq(timelineSteps.timelineId, timelines.id))
      .groupBy(cycles.id);
  }

  listSummaries(): Promise<CycleSummaryRow[]> {
    return this.summaries().orderBy(desc(cycles.year));
  }

  async findSummary(id: number): Promise<CycleSummaryRow | undefined> {
    const [row] = await this.summaries().where(eq(cycles.id, id));
    return row;
  }
}
