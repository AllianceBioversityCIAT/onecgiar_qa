import { Inject, Injectable } from '@nestjs/common';
import { and, eq, exists, gte, inArray, or, sql } from 'drizzle-orm';
// A pure constant from a file, not the `IngestionModule`: the lease has one
// source (step-1-loads DD-5, DD-6) and DD-9 forbids only the module import.
import { LOAD_LEASE_MS } from '../../ingestion/load-rules.js';
import { DRIZZLE } from '../../database/drizzle/drizzle.constants.js';
import type { DrizzleDB } from '../../database/drizzle/drizzle.module.js';
import { timelineLoads } from '../../database/drizzle/schema/timeline-loads.js';
import { timelineResults } from '../../database/drizzle/schema/timeline-results.js';
import { timelines } from '../../database/drizzle/schema/timelines.js';
import {
  ADMIN_CONFIG_CLOCK,
  type AdminConfigClock,
} from '../admin-config.clock.js';

export const TIMELINE_LOADS = Symbol('TIMELINE_LOADS');

/**
 * "Does this timeline have a load?" (timeline-edit design 7.4, DD-3). The view
 * needs it for the hold (FR-6) and, later, the edit rules for the scope lock
 * (FR-4). Batched: one call answers every timeline of a read, at most one
 * statement, so the list stays a fixed number of queries (NFR-5).
 */
export interface TimelineLoads {
  /** The ids, among `timelineIds`, that have a load. */
  withLoad(timelineIds: readonly number[]): Promise<ReadonlySet<number>>;
}

/**
 * The test double: no timeline has a load, and answering costs no query, so the
 * list count stays at six (NFR-5). Production binds `DrizzleTimelineLoads`
 * (step-1-loads DD-7); the edit suites keep this one, or an explicit fake, so
 * they judge the edit with no load world behind them (NFR-6).
 */
@Injectable()
export class NoTimelineLoads implements TimelineLoads {
  async withLoad(): Promise<ReadonlySet<number>> {
    return new Set<number>();
  }
}

/**
 * The real adapter (step-1-loads design 7.6, DD-9): one statement over the
 * ingestion tables. A timeline has a load when it has a `timeline_results` row,
 * a `completed` load (also with zero members, S-6), or a `running` load whose
 * lease is alive. A `failed` load counts for nothing, and a `running` one whose
 * heartbeat is older than the lease reads as abandoned (`effectiveLoadStatus`),
 * so it is left out here too. The edit reads this before its transaction; the
 * load start bumps `timelines.version` under the timeline lock (DD-7), which is
 * what keeps that read from going stale unnoticed.
 */
@Injectable()
export class DrizzleTimelineLoads implements TimelineLoads {
  constructor(
    @Inject(DRIZZLE) private readonly db: Pick<DrizzleDB, 'select'>,
    @Inject(ADMIN_CONFIG_CLOCK) private readonly clock: AdminConfigClock,
  ) {}

  async withLoad(timelineIds: readonly number[]): Promise<ReadonlySet<number>> {
    if (timelineIds.length === 0) return new Set<number>();
    // Alive while `now - heartbeat <= lease`, the strict rule of the pure lease.
    const aliveSince = new Date(this.clock().getTime() - LOAD_LEASE_MS);
    const rows = await this.db
      .select({ id: timelines.id })
      .from(timelines)
      .where(
        and(
          inArray(timelines.id, [...timelineIds]),
          or(
            exists(
              this.db
                .select({ one: sql`1` })
                .from(timelineResults)
                .where(eq(timelineResults.timelineId, timelines.id)),
            ),
            exists(
              this.db
                .select({ one: sql`1` })
                .from(timelineLoads)
                .where(
                  and(
                    eq(timelineLoads.timelineId, timelines.id),
                    or(
                      eq(timelineLoads.status, 'completed'),
                      and(
                        eq(timelineLoads.status, 'running'),
                        gte(timelineLoads.heartbeatAt, aliveSince),
                      ),
                    ),
                  ),
                ),
            ),
          ),
        ),
      );
    return new Set(rows.map((row) => row.id));
  }
}
