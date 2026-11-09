// @akili-spec ingestion/step-1-loads
// @akili-spec ingestion/timeline-sync
import { Inject, Injectable, Optional } from '@nestjs/common';
import { nowInRome } from '../admin-config/rome-date.js';
import {
  DrizzleIdempotencyStore,
  IDEMPOTENCY_CLOCK,
  type IdempotencyClock,
  type IdempotencyStore,
  type Reservation,
} from '../common/idempotency/idempotency.store.js';
import { DRIZZLE } from '../database/drizzle/drizzle.constants.js';
import type { DrizzleDB } from '../database/drizzle/drizzle.module.js';
import type { NewTimelineAuditEvent } from '../database/drizzle/schema/timeline-audit-events.js';
import type {
  TimelineLoad,
  TimelineLoadFailureReason,
  TimelineLoadScope,
  TimelineLoadStatus,
} from '../database/drizzle/schema/timeline-loads.js';
import type {
  TimelineResultKpGroup,
  TimelineResultStatus,
} from '../database/drizzle/schema/timeline-results.js';
import {
  EMPTY_SUMMARY,
  effectiveLoadStatus,
  entryRound,
  membershipEnds,
  mergeSummary,
  type LoadSummary,
  type ReturnedNotResubmitted,
  stepInForce,
  syncWindow,
  type SkipReason,
} from './load-rules.js';
import {
  DrizzleLoadsStore,
  type CycleMembershipRow,
  type LoadEndValues,
  type LoadsStore,
} from './loads.store.js';

export const LOADS_TRANSACTIONS = Symbol('LOADS_TRANSACTIONS');

/** The stores of one loads transaction (design 7.2, 7.3). */
export interface LoadsRepositories {
  loads: LoadsStore;
  /**
   * The exactly-once fence: `markExecuted` bound to THIS transaction, so the
   * mark commits or rolls back with the load. Only that method is exposed;
   * `reserve`, `complete` and `release` belong to the interceptor's own writes.
   */
  idempotency: Pick<IdempotencyStore, 'markExecuted'>;
}

/** Runs `work` in one database transaction: it commits when `work` resolves, rolls back when it throws. */
export interface LoadsTransactions {
  run<T>(work: (repositories: LoadsRepositories) => Promise<T>): Promise<T>;
}

/**
 * One MySQL transaction for a loads write, in the shape of
 * `DrizzleTimelinesUnitOfWork`: READ COMMITTED, the stores bound to the
 * transaction, and the idempotency store whose `markExecuted` commits with the
 * change. Nothing here has a rule; the sequences are `LoadsUnitOfWork`'s.
 */
@Injectable()
export class DrizzleLoadsTransactions implements LoadsTransactions {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    // The clock the module binds for the interceptor's store. Optional so the
    // unit's own specs can build the adapter without a module.
    @Optional()
    @Inject(IDEMPOTENCY_CLOCK)
    private readonly clock: IdempotencyClock = () => new Date(),
  ) {}

  run<T>(work: (repositories: LoadsRepositories) => Promise<T>): Promise<T> {
    return this.db.transaction(
      (tx) =>
        work({
          loads: new DrizzleLoadsStore(tx),
          idempotency: new DrizzleIdempotencyStore(tx, this.clock),
        }),
      // READ COMMITTED, as the timelines unit of work: the locking reads are
      // current reads at any level, and a plain read never carries a snapshot
      // from before another transaction's commit.
      { isolationLevel: 'read committed' },
    );
  }
}

export interface StartLoadCommand {
  cycleId: number;
  timelineId: number;
  /** The ADMIN who starts the load: `started_by` and the actor of the audit rows. */
  actorId: number;
  requestId: string | null;
  /** The clock, read once by the service: the window, the lease and every stamp use this instant. */
  now: Date;
  /** A keyed request carries its reservation; without the header nothing is marked. */
  reservation?: Reservation;
}

/** The refusals are typed results: the service maps them to the 404 / 409 of FR-2. */
export type StartLoadResult =
  | {
      kind: 'started';
      loadId: number;
      /** Stale `running` loads of the cycle that this start persisted as `failed` / `ABANDONED` (FR-9). */
      abandonedLoadIds: number[];
    }
  | { kind: 'timeline_not_found' }
  | { kind: 'cycle_closed' }
  | { kind: 'window_closed' }
  | { kind: 'already_running' };

/** What a result brings to a lot: the per-result columns; the cycle, timeline, load and phase year are the load's. */
export interface LotMembership {
  resultCode: number;
  resultId: number;
  programClarisaId: number;
  resultTypeKey: string;
  status: TimelineResultStatus;
  kpGroup: TimelineResultKpGroup | null;
  awaitsStep: number | null;
  snapshotSk: string;
  snapshotHash: string;
  catalogVersion: string;
  /**
   * How the verdict took it (design 7.3 step 2): `resubmitted` counts under
   * `loadedResubmitted`. Absent = `new` (the runner sets it from T-6).
   */
  kind?: 'new' | 'resubmitted';
  /** The membership it was compared with (FR-8); absent = null, no earlier snapshot. */
  previousMembershipId?: number | null;
  /** The keys that changed (FR-8); absent = null. Null exactly when `previousMembershipId` is. */
  changedFields?: string[] | null;
}

export interface RecordLotCommand {
  loadId: number;
  /** The results to make members, snapshots already written (DD-4). */
  memberships: readonly LotMembership[];
  /** Every result the lot went through, loaded or skipped: `processed` goes up by this (FR-3). */
  processed: number;
  /**
   * The skips decided before the transaction (read, intake, details). The
   * loaded counts are not passed: the transaction counts what it inserted.
   */
  skips: Pick<LoadSummary, 'skipped' | 'otherTimelines'>;
  now: Date;
}

/** A membership the unique keys refused: a race, recorded as a skip and never a failure (FR-4). */
export interface RaceSkip {
  resultCode: number;
  reason: Extract<
    SkipReason,
    'ACTIVE_IN_OTHER_TIMELINE' | 'ALREADY_IN_THIS_TIMELINE'
  >;
  /** The blocking timeline, when the skip is `ACTIVE_IN_OTHER_TIMELINE` and it could be read. */
  timelineId?: number;
}

export type RecordLotResult =
  | {
      kind: 'recorded';
      insertedCodes: number[];
      raceSkips: RaceSkip[];
      /** `processed` of the load after this lot. */
      processed: number;
    }
  | { kind: 'load_not_found' }
  /** The load ended meanwhile (abandoned by a later start): nothing was written and the run must stop. */
  | { kind: 'load_not_running'; status: TimelineLoadStatus };

export interface EndExpiredCommand {
  /** The timeline of the running load: its own memberships are never ended here. */
  timelineId: number;
  /** The memberships read for the lot (`LoadsStore.findMemberships`). */
  memberships: readonly CycleMembershipRow[];
  now: Date;
}

/** How a load ends: a failure always carries its reason, typed from the closed list of design 5.1. */
export type LoadEnding =
  | { status: 'completed' }
  | { status: 'failed'; failureReason: TimelineLoadFailureReason };

export type EndLoadCommand = LoadEnding & {
  loadId: number;
  now: Date;
  /** Counted once at the end of the run (design 7.3 step 7, DD-7); written into the summary in the end's transaction. */
  returnedNotResubmitted?: ReturnedNotResubmitted;
};

export type EndLoadResult =
  | { kind: 'ended' }
  | { kind: 'load_not_found' }
  /** Already ended (for example abandoned): nothing was written, so the load has one `load_end` row only. */
  | { kind: 'load_not_running'; status: TimelineLoadStatus };

/** A refusal found inside the start's transaction: thrown so everything it wrote is rolled back. */
class StartRefused extends Error {
  constructor(readonly result: Exclude<StartLoadResult, { kind: 'started' }>) {
    super(result.kind);
  }
}

function storedSummary(value: unknown): LoadSummary {
  if (typeof value !== 'object' || value === null) return EMPTY_SUMMARY;
  const stored = value as Partial<LoadSummary>;
  // A summary from before 0008 lacks the new keys: every load it counts was
  // new, in round 1, with no returned results counted (design 5.3).
  return {
    ...EMPTY_SUMMARY,
    returnedNotResubmitted: { total: 0, byProgram: {}, byType: {} },
    loadedNew: stored.loaded ?? 0,
    ...stored,
  };
}

const skippedTotal = (summary: LoadSummary): number =>
  Object.values(summary.skipped).reduce((sum, count) => sum + count, 0);

function bump(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

/** The `load_end` audit row (design 5.3): the load as it stood when it ended, no PII. */
function loadEndAudit(
  load: TimelineLoad,
  ending: Pick<LoadEndValues, 'status' | 'failureReason'>,
  requestId: string | null,
  at: Date,
): NewTimelineAuditEvent {
  const summary = storedSummary(load.summary);
  return {
    timelineId: load.timelineId,
    // The user who started the load (design 5.3), also when the system ends it.
    actorId: load.startedBy,
    action: 'load_end',
    changes: {
      load: {
        before: 'running',
        after: {
          // Ties the end row to its load (FR-12, design 5.3).
          id: load.id,
          status: ending.status,
          total: load.total,
          processed: load.processed,
          loaded: summary.loaded,
          // FR-11, design 5.5: the load's round (its column) and the split of `loaded`.
          loadedNew: summary.loadedNew,
          loadedResubmitted: summary.loadedResubmitted,
          round: load.round,
          skipped: skippedTotal(summary),
          failureReason: ending.failureReason,
        },
      },
    },
    requestId,
    createdAt: at,
  };
}

/**
 * The lock order of the lot and the end of a load: the cycle row `FOR SHARE`,
 * the timeline row `FOR SHARE`, then the load row `FOR UPDATE`. The ids come
 * from a plain read of the load, whose cycle and timeline never change. Returns
 * the load as locked, or `undefined` when there is none.
 */
async function lockLoadInStartOrder(
  loads: LoadsStore,
  loadId: number,
): Promise<TimelineLoad | undefined> {
  const seen = await loads.findLoadById(loadId);
  if (!seen) return undefined;
  await loads.lockCycleShared(seen.cycleId);
  await loads.lockTimelineShared(seen.timelineId);
  return loads.lockLoad(loadId);
}

/**
 * The four database decisions of a step-1 load (design 7.2, 7.3). Each method
 * is one transaction; the sequences and what the unique keys decide are here,
 * the statements are `LoadsStore`'s, and the rules are `load-rules.ts`'s.
 *
 * Lock order (DD-9, P-8), the same in every transaction here: the cycle row
 * `FOR SHARE`, then the timeline row (`FOR UPDATE` in the start, `FOR SHARE` in
 * the lot and the end), then the load row `FOR UPDATE`, then the writes; the
 * idempotency row last, through `markExecuted`. It is the order of the timeline
 * edit, so a start and an edit of one timeline serialize without a deadlock.
 *
 * Why the lot and the end lock the parents first: InnoDB checks a foreign key
 * by taking S on the parent row, so the membership insert (parents: cycle,
 * timeline, load) and the `load_end` audit insert (parent: timeline) need S on
 * the timeline. A lot that held the load row first and asked for the timeline
 * after would wait for a start that holds the timeline `FOR UPDATE` and waits
 * for that load row: a deadlock (1213), and a 500 where the start owes a 409.
 * The start does the same for a stale running load of another timeline: it
 * takes S on that timeline before the load row, for the `load_end` row it
 * writes for it. `endExpired` takes no parent lock: its UPDATE writes no
 * foreign-key column. Readers never lock.
 */
@Injectable()
export class LoadsUnitOfWork {
  constructor(
    @Inject(LOADS_TRANSACTIONS)
    private readonly transactions: LoadsTransactions,
  ) {}

  /**
   * Design 7.2 step 2. A refusal writes nothing: it rolls the transaction back
   * and comes back as a typed result. Two starts at once (one timeline or two
   * of one cycle) end with one `started`: the loser's insert is refused by
   * `uq_timeline_loads_running_key`, the database deciding and not a read (FR-2).
   */
  async start(command: StartLoadCommand): Promise<StartLoadResult> {
    try {
      return await this.transactions.run(async ({ loads, idempotency }) => {
        const cycle = await loads.lockCycleShared(command.cycleId);
        if (!cycle) throw new StartRefused({ kind: 'timeline_not_found' });
        const timeline = await loads.findTimelineForUpdate(command.timelineId);
        if (!timeline || timeline.cycleId !== command.cycleId) {
          throw new StartRefused({ kind: 'timeline_not_found' });
        }
        // Every step, read under the timeline lock (design 7.1 step 2): an edit
        // takes the same lock, so it cannot move them before the insert below.
        const steps = await loads.findSteps(timeline.id);
        // Step 1 always exists (FR-9 of *timelines*); without it the data is corrupt.
        if (steps.length === 0) {
          throw new Error(`Timeline ${timeline.id} has no steps`);
        }
        const nowMinute = nowInRome(command.now);

        // 2.1 and 2.2: the closed cycle first, then the window, which ends with
        // the closing minute of the LAST step (FR-1).
        const lastStep = steps.reduce((last, step) =>
          step.position > last.position ? step : last,
        );
        const window = syncWindow(cycle.status, lastStep.closesAt, nowMinute);
        if (window === 'CYCLES_CLOSED') {
          throw new StartRefused({ kind: 'cycle_closed' });
        }
        if (window === 'LOADS_WINDOW_CLOSED') {
          throw new StartRefused({ kind: 'window_closed' });
        }
        // The step in force and its stored round (FR-2, DD-1); only an accepted
        // start gets here, so a refusal never reads the round.
        const step = stepInForce(steps, nowMinute);
        const round = entryRound(steps, nowMinute);

        // 2.3: a running load whose lease expired no longer blocks (DD-6). The
        // abandon writes a `load_end` row for the load's own timeline, whose
        // foreign key takes S on that timeline row; when it is not this start's
        // own, that lock is taken now, before the load row, as the lot and the
        // end take it (they hold the timeline, then the load).
        const abandonedLoadIds: number[] = [];
        const seen = await loads.findRunningLoad(command.cycleId);
        if (
          seen &&
          seen.timelineId !== timeline.id &&
          effectiveLoadStatus(seen.status, seen.heartbeatAt, command.now)
            .status === 'failed'
        ) {
          await loads.lockTimelineShared(seen.timelineId);
        }
        const running = await loads.lockRunningLoad(command.cycleId);
        if (running) {
          const effective = effectiveLoadStatus(
            running.status,
            running.heartbeatAt,
            command.now,
          );
          if (effective.status === 'failed') {
            const ended = await loads.endLoad(running.id, {
              status: 'failed',
              failureReason: effective.failureReason,
              finishedAt: command.now,
            });
            if (ended) {
              abandonedLoadIds.push(running.id);
              await loads.insertAuditEvent(
                loadEndAudit(
                  running,
                  { status: 'failed', failureReason: effective.failureReason },
                  command.requestId,
                  command.now,
                ),
              );
            }
          }
        }

        // The scope is read under the timeline lock: an edit commits before
        // this read or finds the version moved (FR-11, DD-7).
        const { programIds, resultTypeKeys } = await loads.findScope(
          timeline.id,
        );
        const scope: TimelineLoadScope = {
          allPrograms: timeline.allPrograms,
          programIds,
          allResultTypes: timeline.allResultTypes,
          resultTypeKeys,
        };

        // 2.4: the database decides the race between two starts.
        const inserted = await loads.insertLoad({
          cycleId: command.cycleId,
          timelineId: timeline.id,
          timelineStepId: step.id,
          stepPosition: step.position,
          round,
          phaseYear: cycle.year,
          scope,
          // The lots merge into this summary, and `mergeSummary` needs the
          // load's round in it (one load is one round).
          summary: { ...EMPTY_SUMMARY, round },
          startedBy: command.actorId,
          startedAt: command.now,
          requestId: command.requestId,
        });
        if (inserted.kind === 'already_running') {
          throw new StartRefused({ kind: 'already_running' });
        }

        // 2.5 to 2.7.
        await loads.bumpTimelineVersion(timeline.id);
        await loads.insertAuditEvent({
          timelineId: timeline.id,
          actorId: command.actorId,
          action: 'load_start',
          changes: {
            load: {
              before: null,
              after: {
                id: inserted.loadId,
                phaseYear: cycle.year,
                scope,
                // FR-11, design 5.5.
                round,
                stepPosition: step.position,
              },
            },
          },
          requestId: command.requestId,
          createdAt: command.now,
        });
        if (command.reservation) {
          await idempotency.markExecuted(command.reservation, inserted.loadId);
        }
        return { kind: 'started', loadId: inserted.loadId, abandonedLoadIds };
      });
    } catch (error) {
      if (error instanceof StartRefused) return error.result;
      throw error;
    }
  }

  /**
   * Design 7.3 step 2.1, DD-5: the short transaction of a later load that ends
   * the active memberships of OTHER timelines whose last step has closed. The
   * rule is `membershipEnds`, the single source; no job ever runs it. With
   * nothing to end no transaction is opened.
   */
  async endExpired(command: EndExpiredCommand): Promise<{ ended: number }> {
    const now = nowInRome(command.now);
    const ids = command.memberships
      .filter(
        (m) =>
          m.timelineId !== command.timelineId &&
          m.endedAt === null &&
          membershipEnds(m.lastStepClosesAt, now),
      )
      .map((m) => m.id);
    if (ids.length === 0) return { ended: 0 };
    return this.transactions.run(async ({ loads }) => ({
      ended: await loads.endMemberships(ids, command.now, 'timeline_closed'),
    }));
  }

  /**
   * Design 7.3 steps 2.6 and 2.7, one transaction: the memberships row by row,
   * then the progress, the heartbeat and the merged summary. The load row is
   * locked first, so a lot of a load that a later start abandoned writes
   * nothing, and a lot that renews the heartbeat in time makes that start see a
   * live lease (FR-9). A duplicate on `active_key` or on `(timeline_id,
   * result_code, entry_round)` is a race: a skip judged by the key the database names, and
   * the lot goes on (FR-4). Any other error rolls the whole lot back.
   */
  async recordLot(command: RecordLotCommand): Promise<RecordLotResult> {
    return this.transactions.run(async ({ loads }) => {
      const load = await lockLoadInStartOrder(loads, command.loadId);
      if (!load) return { kind: 'load_not_found' };
      if (load.status !== 'running') {
        return { kind: 'load_not_running', status: load.status };
      }

      const insertedCodes: number[] = [];
      const raceSkips: RaceSkip[] = [];
      const stored = storedSummary(load.summary);
      const lot: LoadSummary = {
        ...EMPTY_SUMMARY,
        // One load is one round: the lot carries the load's (mergeSummary throws on a mismatch).
        round: stored.round,
        byProgram: {},
        byType: {},
        kpGroups: {},
        skipped: { ...command.skips.skipped },
        otherTimelines: structuredClone(command.skips.otherTimelines),
      };
      for (const lotMembership of command.memberships) {
        const { kind, previousMembershipId, changedFields, ...membership } =
          lotMembership;
        const outcome = await loads.insertMembership({
          ...membership,
          cycleId: load.cycleId,
          timelineId: load.timelineId,
          loadId: load.id,
          phaseYear: load.phaseYear,
          createdAt: command.now,
          // One load is one round (FR-2): the row's entry round is the load's.
          entryRound: load.round,
          previousMembershipId: previousMembershipId ?? null,
          changedFields: changedFields ?? null,
        });
        if (outcome.kind === 'created') {
          insertedCodes.push(membership.resultCode);
          lot.loaded++;
          if (kind === 'resubmitted') lot.loadedResubmitted++;
          else lot.loadedNew++;
          bump(lot.byProgram, String(membership.programClarisaId));
          bump(lot.byType, membership.resultTypeKey);
          if (membership.kpGroup !== null)
            bump(lot.kpGroups, membership.kpGroup);
          continue;
        }
        // The key named decides the reason (design 7.3 step 6).
        if (outcome.key === 'timeline_code_round') {
          raceSkips.push({
            resultCode: membership.resultCode,
            reason: 'ALREADY_IN_THIS_TIMELINE',
          });
          bump(lot.skipped, 'ALREADY_IN_THIS_TIMELINE');
          continue;
        }
        // `active_key` refused it. Another timeline holding the result is the
        // usual cause; but either key may be named (T-9 pins which on live
        // MySQL), so a membership of THIS timeline, active or entered in this
        // load's round (FR-4 rule 2, FR-5), can be reported here as well. Read
        // the memberships to tell them apart.
        const held = await loads.findMemberships(load.cycleId, [
          membership.resultCode,
        ]);
        const blocker = held.find(
          (m) => m.timelineId !== load.timelineId && m.endedAt === null,
        );
        if (
          !blocker &&
          held.some(
            (m) =>
              m.timelineId === load.timelineId &&
              (m.endedAt === null || m.entryRound === load.round),
          )
        ) {
          raceSkips.push({
            resultCode: membership.resultCode,
            reason: 'ALREADY_IN_THIS_TIMELINE',
          });
          bump(lot.skipped, 'ALREADY_IN_THIS_TIMELINE');
          continue;
        }
        // Another timeline won the cycle-wide key: name it for the summary.
        raceSkips.push({
          resultCode: membership.resultCode,
          reason: 'ACTIVE_IN_OTHER_TIMELINE',
          timelineId: blocker?.timelineId,
        });
        bump(lot.skipped, 'ACTIVE_IN_OTHER_TIMELINE');
        if (blocker) {
          const known = lot.otherTimelines[String(blocker.timelineId)];
          lot.otherTimelines[String(blocker.timelineId)] = {
            name: blocker.timelineName,
            count: (known?.count ?? 0) + 1,
          };
        }
      }

      const processed = load.processed + command.processed;
      await loads.recordProgress(load.id, {
        processed,
        summary: mergeSummary(stored, lot),
        heartbeatAt: command.now,
      });
      return { kind: 'recorded', insertedCodes, raceSkips, processed };
    });
  }

  /**
   * Design 7.3 step 1: `total`, once every page is listed. One statement on the
   * load row alone (no foreign key is written), so it adds no lock order. `false`
   * = the load is no longer running.
   */
  setTotal(loadId: number, total: number): Promise<boolean> {
    return this.transactions.run(({ loads }) => loads.setTotal(loadId, total));
  }

  /**
   * Design 7.3 step 5, FR-9: the timer's heartbeat. One statement on the load
   * row alone. `false` = the load is no longer running (abandoned, or ended).
   */
  heartbeat(loadId: number, now: Date): Promise<boolean> {
    return this.transactions.run(({ loads }) =>
      loads.renewHeartbeat(loadId, now),
    );
  }

  /**
   * Design 7.3 step 3 and 4, FR-12: the load becomes `completed` or `failed`
   * and its `load_end` row is written in the same transaction. The conditional
   * update decides, so a load that ended meanwhile is never ended again and has
   * exactly one `load_end` row. What earlier lots recorded stays (FR-8).
   */
  async end(command: EndLoadCommand): Promise<EndLoadResult> {
    return this.transactions.run(async ({ loads }) => {
      const load = await lockLoadInStartOrder(loads, command.loadId);
      if (!load) return { kind: 'load_not_found' };
      if (load.status !== 'running') {
        return { kind: 'load_not_running', status: load.status };
      }
      const ending = {
        status: command.status,
        failureReason:
          command.status === 'failed' ? command.failureReason : null,
      };
      if (command.returnedNotResubmitted) {
        await loads.recordProgress(load.id, {
          processed: load.processed,
          summary: {
            ...storedSummary(load.summary),
            returnedNotResubmitted: command.returnedNotResubmitted,
          },
          // The lease is not this write's to move.
          heartbeatAt: load.heartbeatAt,
        });
      }
      const ended = await loads.endLoad(load.id, {
        ...ending,
        finishedAt: command.now,
      });
      if (!ended) return { kind: 'load_not_running', status: load.status };
      await loads.insertAuditEvent(
        loadEndAudit(load, ending, load.requestId, command.now),
      );
      return { kind: 'ended' };
    });
  }
}
