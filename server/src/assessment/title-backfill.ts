// @akili-spec assessment/step-1-assessment
import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle/drizzle.constants.js';
import type { DrizzleDB } from '../database/drizzle/drizzle.module.js';
import { timelineResults } from '../database/drizzle/schema/timeline-results.js';
import { snapshotKeyOf, titleOf } from '../ingestion/load-rules.js';
import {
  SNAPSHOT_STORE,
  type SnapshotStore,
} from '../ingestion/snapshot-store.port.js';

// Title backfill (FR-24, design 7.8, DD-9): memberships loaded before
// `timeline_results.title` existed get their title from their snapshot, once,
// with no manual SQL. It runs on application bootstrap WITHOUT being awaited,
// in pages of 50, and each write is a conditional UPDATE that only fills a
// title still null, so a load that titles the row meanwhile is never
// overwritten and a second run writes nothing.

export const TITLE_BACKFILL_STORE = Symbol('TITLE_BACKFILL_STORE');

/** Rows read per page (design 7.8). */
export const TITLE_BACKFILL_PAGE_SIZE = 50;

export interface UntitledMembership {
  id: number;
  resultCode: number;
  /** The whole `timeline_results.snapshot_sk` (with its prefix). */
  snapshotSk: string;
}

export interface TitleBackfillStore {
  /** Memberships with a null title and `id > afterId`, in id order, at most `limit`. */
  untitledAfter(afterId: number, limit: number): Promise<UntitledMembership[]>;
  /** Sets the title only while it is still null; false when the row was not changed. */
  setTitleIfNull(id: number, title: string): Promise<boolean>;
}

export interface TitleBackfillResult {
  /** Untitled rows read. */
  scanned: number;
  /** Rows given a title. */
  titled: number;
  /** Rows left null: no snapshot, no string title, or titled by another writer meanwhile. */
  missing: number;
}

@Injectable()
export class DrizzleTitleBackfillStore implements TitleBackfillStore {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  /** Exposed so the spec can read the generated SQL (`toSQL()`). */
  buildPage(afterId: number, limit: number) {
    return this.db
      .select({
        id: timelineResults.id,
        resultCode: timelineResults.resultCode,
        snapshotSk: timelineResults.snapshotSk,
      })
      .from(timelineResults)
      .where(
        and(isNull(timelineResults.title), gt(timelineResults.id, afterId)),
      )
      .orderBy(asc(timelineResults.id))
      .limit(limit);
  }

  /** `UPDATE … SET title = ? WHERE id = ? AND title IS NULL` (DD-9). */
  buildUpdate(id: number, title: string) {
    return this.db
      .update(timelineResults)
      .set({ title })
      .where(and(eq(timelineResults.id, id), isNull(timelineResults.title)));
  }

  untitledAfter(afterId: number, limit: number): Promise<UntitledMembership[]> {
    return this.buildPage(afterId, limit);
  }

  async setTitleIfNull(id: number, title: string): Promise<boolean> {
    const [header] = await this.buildUpdate(id, title);
    return header.affectedRows > 0;
  }
}

@Injectable()
export class TitleBackfill
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(TitleBackfill.name);
  private running: Promise<void> = Promise.resolve();
  private stopRequested = false;

  constructor(
    @Inject(TITLE_BACKFILL_STORE) private readonly store: TitleBackfillStore,
    @Inject(SNAPSHOT_STORE) private readonly snapshots: SnapshotStore,
  ) {}

  /** Starts the work and returns at once: the bootstrap never waits for it. */
  onApplicationBootstrap(): void {
    this.running = this.runLogged();
  }

  /**
   * Asks the loop to stop after the row in hand, then waits for the run to
   * end. It runs before every `onApplicationShutdown`, where `DrizzleModule`
   * closes the pool, so the pool is never closed under a running backfill.
   * Never rejects.
   */
  async beforeApplicationShutdown(): Promise<void> {
    this.stopRequested = true;
    await this.running;
  }

  /** Resolves when the started run is over; it never rejects. Used by tests. */
  whenDone(): Promise<void> {
    return this.running;
  }

  async run(): Promise<TitleBackfillResult> {
    const result: TitleBackfillResult = { scanned: 0, titled: 0, missing: 0 };
    let afterId = 0;
    while (!this.stopRequested) {
      const page = await this.store.untitledAfter(
        afterId,
        TITLE_BACKFILL_PAGE_SIZE,
      );
      for (const row of page) {
        if (this.stopRequested) return result;
        result.scanned++;
        afterId = row.id;
        const snapshot = await this.snapshots.get(
          row.resultCode,
          snapshotKeyOf(row.snapshotSk),
        );
        const title = snapshot ? titleOf(snapshot.values) : null;
        if (
          title !== null &&
          (await this.store.setTitleIfNull(row.id, title))
        ) {
          result.titled++;
        } else {
          result.missing++;
        }
      }
      if (page.length < TITLE_BACKFILL_PAGE_SIZE) return result;
    }
    return result;
  }

  /** Counts only; an error is reduced to its class name, never its message (it can carry a host or a value). */
  private async runLogged(): Promise<void> {
    try {
      const result = await this.run();
      this.logger.log({ event: 'assessment_title_backfill', ...result });
    } catch (error) {
      this.logger.error({
        event: 'assessment_title_backfill',
        outcome: 'failed',
        error: error instanceof Error ? error.name : 'unknown',
      });
    }
  }
}
