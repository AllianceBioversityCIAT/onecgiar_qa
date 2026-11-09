// @akili-spec ingestion/step-1-loads
// @akili-spec ingestion/timeline-sync
import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  ADMIN_CONFIG_CLOCK,
  type AdminConfigClock,
} from '../admin-config/admin-config.clock.js';
import type { AdminConfigContext } from '../admin-config/admin-config.context.js';
import {
  CycleClosedError,
  TimelineNotFoundError,
} from '../admin-config/admin-config.errors.js';
import { nowInRome } from '../admin-config/rome-date.js';
import {
  TIMELINES_STORE,
  type TimelinesStore,
} from '../admin-config/timelines/timelines.store.js';
import type { Timeline } from '../database/drizzle/schema/timelines.js';
import type { TimelineLoad } from '../database/drizzle/schema/timeline-loads.js';
import { UpstreamUnavailableError } from '../users/catalogs/catalogs.errors.js';
import { listEveryPage } from './feed-paging.js';
import {
  KP_RULE_KEYS,
  KP_RULES,
  KP_TYPE_KEY,
  type KpRules,
} from './kp-classifier.js';
import {
  EMPTY_SUMMARY,
  effectiveLoadStatus,
  entryRound,
  skipVerdict,
  stepInForce,
  syncWindow,
  type LoadSummary,
  type ReturnedNotResubmitted,
  type TakeVerdict,
} from './load-rules.js';
import {
  LoadAlreadyRunningError,
  LoadCatalogMissingError,
  LoadNotFoundError,
  LoadWindowClosedError,
} from './loads.errors.js';
import {
  LOADS_STORE,
  type CycleMembershipRow,
  type LoadRow,
  type LoadsStore,
} from './loads.store.js';
import { LoadsUnitOfWork } from './loads.unit-of-work.js';
import {
  FeedError,
  RESULTS_FEED,
  type FeedListItem,
  type ResultsFeed,
} from './results-feed.port.js';

/** The runner of a started load (design 7.3), injected so the service never imports it. */
export const LOAD_RUNNER = Symbol('LOAD_RUNNER');

export interface LoadRunnerPort {
  /** Fire and forget: the runner is not awaited and records its own failure. */
  run(loadId: number): void;
}

/** KP details are read in lots of 50 (design 7.1 step 4). */
const DETAILS_LOT = 50;

const SKIP_ORDER = [
  'ACTIVE_IN_OTHER_TIMELINE',
  'ALREADY_IN_THIS_TIMELINE',
  'RETURNED_NOT_RESUBMITTED',
  'DUPLICATE_RESULT_CODE',
];

export interface SkippedView {
  reason: string;
  count: number;
  /** The other timelines that hold the results, only for `ACTIVE_IN_OTHER_TIMELINE`. */
  timelines?: Array<{ id: number; name: string; count: number }>;
}

export interface KpGroupsView {
  notInQa: number;
  autoChecked: number;
  review: number;
}

/**
 * FR-9: the round-1 memberships of the timeline ended `returned` with no
 * round-2 membership. `code` is only filled where the preview knows it (the
 * program is still in the feed); a stored summary carries no code.
 */
export interface ReturnedNotResubmittedView {
  total: number;
  byProgram: Array<{ programId: number; code?: string; count: number }>;
  byResultType: Array<{ key: string; count: number }>;
}

/** FR-1, FR-9, FR-10: what a sync would do now. Nothing was written, in QA or in Reporting. */
export interface LoadPreview {
  phaseYear: number;
  /** `closed` when the cycle is closed or the last step of the timeline has closed (FR-1). */
  window: 'open' | 'closed';
  /** The round and the step position a sync started now would be recorded with (FR-10). */
  round: number;
  stepPosition: number;
  toLoad: {
    total: number;
    /** `new + resubmitted = total` (FR-9). */
    new: number;
    resubmitted: number;
    byProgram: Array<{ programId: number; code: string; count: number }>;
    byResultType: Array<{ key: string; count: number }>;
  };
  returnedNotResubmitted: ReturnedNotResubmittedView;
  kpGroups: KpGroupsView;
  skipped: SkippedView[];
}

/** FR-2: the 202 answer. */
export interface StartedLoad {
  id: number;
  status: 'running';
}

/** FR-10: a load as the list shows it. A stale `running` load reads `failed` / `ABANDONED` (FR-9). */
export interface LoadItem {
  id: number;
  status: string;
  total: number | null;
  processed: number;
  startedAt: string;
  finishedAt: string | null;
  startedBy: { id: number; nickname: string | null };
  failureReason: string | null;
  /** FR-10: the round and step position the sync was recorded with; a load from before the 0008 migration reads 1 and 1. */
  round: number;
  stepPosition: number;
}

export interface LoadSummaryView {
  loaded: number;
  /** `loaded = loadedNew + loadedResubmitted` (FR-9). */
  loadedNew: number;
  loadedResubmitted: number;
  round: number;
  returnedNotResubmitted: ReturnedNotResubmittedView;
  byProgram: Array<{ programId: number; count: number }>;
  byResultType: Array<{ key: string; count: number }>;
  kpGroups: KpGroupsView;
  skipped: SkippedView[];
}

export interface LoadDetail extends LoadItem {
  summary: LoadSummaryView;
}

type LoadRoute = 'preview' | 'start' | 'list' | 'get';

const byNumber = (a: number, b: number) => a - b;

/** The skips of a count record, in a fixed reason order, with the other timelines named (design 6). */
function skippedView(
  skipped: Record<string, number>,
  otherTimelines: LoadSummary['otherTimelines'],
): SkippedView[] {
  const reasons = Object.keys(skipped).filter((reason) => skipped[reason]! > 0);
  const rank = (reason: string) => {
    const at = SKIP_ORDER.indexOf(reason);
    return at === -1 ? SKIP_ORDER.length : at;
  };
  return reasons
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((reason) => ({
      reason,
      count: skipped[reason]!,
      ...(reason === 'ACTIVE_IN_OTHER_TIMELINE'
        ? {
            timelines: Object.entries(otherTimelines)
              .map(([id, entry]) => ({ id: Number(id), ...entry }))
              .sort((a, b) => a.id - b.id),
          }
        : {}),
    }));
}

const kpGroupsView = (counts: Record<string, number>): KpGroupsView => ({
  notInQa: counts['not_in_qa'] ?? 0,
  autoChecked: counts['auto_checked'] ?? 0,
  review: counts['review'] ?? 0,
});

/** The returned-not-resubmitted count as the API shows it, the programs and types in a fixed order (FR-9). */
function returnedView(
  counted: ReturnedNotResubmitted,
  codes: ReadonlyMap<number, string> = new Map(),
): ReturnedNotResubmittedView {
  return {
    total: counted.total,
    byProgram: Object.entries(counted.byProgram)
      .map(([id, count]) => {
        const programId = Number(id);
        const code = codes.get(programId);
        return { programId, ...(code === undefined ? {} : { code }), count };
      })
      .sort((a, b) => byNumber(a.programId, b.programId)),
    byResultType: Object.entries(counted.byType)
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  };
}

function summaryView(load: TimelineLoad): LoadSummaryView {
  const stored = load.summary;
  const summary: LoadSummary = {
    ...EMPTY_SUMMARY,
    // A summary from before 0008 lacks the new keys: every load it counts was new (design 5.3).
    loadedNew: typeof stored?.['loaded'] === 'number' ? stored['loaded'] : 0,
    ...stored,
  };
  return {
    loaded: summary.loaded,
    loadedNew: summary.loadedNew,
    loadedResubmitted: summary.loadedResubmitted,
    // The column is the authority (FR-10); a load from before 0008 reads 1.
    round: load.round,
    returnedNotResubmitted: returnedView(summary.returnedNotResubmitted),
    byProgram: Object.entries(summary.byProgram)
      .map(([id, count]) => ({ programId: Number(id), count }))
      .sort((a, b) => byNumber(a.programId, b.programId)),
    byResultType: Object.entries(summary.byType)
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    kpGroups: kpGroupsView(summary.kpGroups),
    skipped: skippedView(summary.skipped, summary.otherTimelines),
  };
}

/** The list item of a load, the lease applied: the stored `running` is never trusted past its heartbeat (FR-9). */
function loadItem({ load, startedBy }: LoadRow, now: Date): LoadItem {
  const effective = effectiveLoadStatus(load.status, load.heartbeatAt, now);
  return {
    id: load.id,
    status: effective.status,
    total: load.total,
    processed: load.processed,
    startedAt: load.startedAt.toISOString(),
    finishedAt: load.finishedAt?.toISOString() ?? null,
    startedBy,
    failureReason: effective.failureReason ?? load.failureReason,
    round: load.round,
    stepPosition: load.stepPosition,
  };
}

/** A MySQL deadlock (1213) in an error chain: the driver error, or the `cause` a wrapper carries. */
function isDeadlock(error: unknown): boolean {
  for (
    let current: unknown = error, depth = 0;
    current instanceof Error && depth < 3;
    current = (current as Error & { cause?: unknown }).cause, depth++
  ) {
    const { code, errno } = current as Error & {
      code?: unknown;
      errno?: unknown;
    };
    if (code === 'ER_LOCK_DEADLOCK' || errno === 1213) return true;
  }
  return false;
}

/**
 * Orchestration of timeline syncs (design 6, 7.1; step-1 design 6, 7.1, 7.2): the preview, the start
 * and the reads. The decisions are the parts it calls: the unit of work for
 * the start (lock order, abandon, insert, audit, key mark), `load-rules.ts`
 * for the window, the lease and the skips, `KP_RULES` for the KP groups. The
 * preview writes nothing, in QA or in Reporting; the start runs the runner
 * only after the load has committed.
 */
@Injectable()
export class LoadsService {
  private readonly logger = new Logger(LoadsService.name);

  constructor(
    @Inject(LoadsUnitOfWork) private readonly unitOfWork: LoadsUnitOfWork,
    @Inject(LOADS_STORE) private readonly loads: LoadsStore,
    @Inject(TIMELINES_STORE)
    private readonly timelines: Pick<TimelinesStore, 'findById' | 'findBundle'>,
    @Inject(RESULTS_FEED) private readonly feed: ResultsFeed,
    @Inject(KP_RULES) private readonly kpRules: KpRules,
    @Inject(LOAD_RUNNER) private readonly runner: LoadRunnerPort,
    @Inject(ADMIN_CONFIG_CLOCK) private readonly clock: AdminConfigClock,
  ) {}

  /**
   * FR-1, design 7.1. Judges the window on the LAST step and the round on the
   * step in force, as the start does. Reads the timeline, then EVERY page of the feed for the
   * timeline's scope, then QA's memberships in one call (the store chunks the
   * `IN` by 500), then the details of the KPs to load in lots of 50. Nothing is
   * written and neither intake nor release is called.
   */
  preview(ctx: AdminConfigContext, timelineId: number): Promise<LoadPreview> {
    return this.logged('preview', ctx, timelineId, async () => {
      const now = this.clock();
      const nowMinute = nowInRome(now);
      const bundle = await this.timelines.findBundle(timelineId);
      if (!bundle) throw new TimelineNotFoundError(timelineId);
      const { timeline, steps } = bundle;
      const cycle = await this.cycleOf(timeline);
      // Step 1 always exists (FR-9 of *timelines*); `stepInForce` throws on a timeline without steps.
      const lastStep = steps.reduce((last, step) =>
        step.position > last.position ? step : last,
      );
      // The same three functions as the start (design 7.1), without a lock.
      const step = stepInForce(steps, nowMinute);
      const round = entryRound(steps, nowMinute);

      const items = await this.reporting(cycle.year, () =>
        listEveryPage(this.feed, {
          phaseYear: cycle.year,
          // "All" sends no filter at all (FR-1): the key is left out.
          ...(timeline.allPrograms ? {} : { programIds: bundle.programIds }),
          ...(timeline.allResultTypes
            ? {}
            : { resultTypeKeys: bundle.resultTypeKeys }),
        }),
      );

      // Design 7.1 step 3: who already holds each result in this cycle.
      const codes = [...new Set(items.map((item) => item.resultCode))];
      const memberships =
        codes.length === 0
          ? []
          : await this.loads.findMemberships(timeline.cycleId, codes);
      const holders = new Map<number, CycleMembershipRow[]>();
      for (const row of memberships) {
        holders.set(row.resultCode, [
          ...(holders.get(row.resultCode) ?? []),
          row,
        ]);
      }
      const listed = new Map<number, number>();
      for (const item of items) {
        listed.set(item.resultCode, (listed.get(item.resultCode) ?? 0) + 1);
      }

      const skipped: Record<string, number> = {};
      const otherTimelines: LoadSummary['otherTimelines'] = {};
      const candidates: FeedListItem[] = [];
      const takes = new Map<number, TakeVerdict<CycleMembershipRow>>();
      for (const item of items) {
        const rows = holders.get(item.resultCode) ?? [];
        const verdict = skipVerdict({
          round,
          timelineId: timeline.id,
          now: nowMinute,
          submittedAt: item.submittedAt,
          memberships: rows,
          duplicated: (listed.get(item.resultCode) ?? 0) > 1,
        });
        if (!('reason' in verdict)) {
          candidates.push(item);
          takes.set(item.resultId, verdict);
          continue;
        }
        skipped[verdict.reason] = (skipped[verdict.reason] ?? 0) + 1;
        if (verdict.timelineId !== undefined) {
          const holder = rows.find(
            (row) => row.timelineId === verdict.timelineId,
          );
          const known = otherTimelines[String(verdict.timelineId)];
          otherTimelines[String(verdict.timelineId)] = {
            name: holder?.timelineName ?? known?.name ?? '',
            count: (known?.count ?? 0) + 1,
          };
        }
      }

      // Design 7.1 step 4: the KPs to load, classified from their details.
      // A result Reporting no longer finds eligible is a skip, as in the run.
      const groups: Record<string, number> = {};
      const ineligible = new Set<number>();
      const kps = candidates.filter(
        (item) => item.resultTypeKey === KP_TYPE_KEY,
      );
      for (let at = 0; at < kps.length; at += DETAILS_LOT) {
        const lot = kps.slice(at, at + DETAILS_LOT);
        const details = await this.reporting(cycle.year, () =>
          this.feed.details({
            phaseYear: cycle.year,
            resultIds: lot.map((item) => item.resultId),
            fieldKeys: [...KP_RULE_KEYS],
          }),
        );
        for (const { resultId, reason } of details.notEligible) {
          ineligible.add(resultId);
          skipped[reason] = (skipped[reason] ?? 0) + 1;
        }
        for (const result of details.results) {
          const take = takes.get(result.resultId);
          // The run's rule (design 7.3 step 4, S-9): a re-submission of the same
          // type keeps its round-1 KP group and is never re-classified; a new
          // result, and a re-submission whose type changed, are classified.
          const kpGroup =
            take?.kind === 'resubmitted' &&
            take.previous?.resultTypeKey === result.resultTypeKey
              ? take.previous.kpGroup
              : this.kpRules.classify({
                  resultTypeKey: result.resultTypeKey,
                  values: result.values,
                }).kpGroup;
          if (kpGroup) groups[kpGroup] = (groups[kpGroup] ?? 0) + 1;
        }
      }

      const toLoad = candidates.filter(
        (item) => !ineligible.has(item.resultId),
      );
      const byProgram = new Map<number, { code: string; count: number }>();
      const byResultType = new Map<string, number>();
      let resubmitted = 0;
      for (const item of toLoad) {
        if (takes.get(item.resultId)?.kind === 'resubmitted') resubmitted++;
        const program = byProgram.get(item.program.clarisaId);
        byProgram.set(item.program.clarisaId, {
          code: item.program.code,
          count: (program?.count ?? 0) + 1,
        });
        byResultType.set(
          item.resultTypeKey,
          (byResultType.get(item.resultTypeKey) ?? 0) + 1,
        );
      }

      // Design 7.3 step 7: counted from QA's own rows, so a returned result the
      // feed no longer lists is in it. The code of a program is known only when
      // the feed still lists one of its results.
      const programCodes = new Map(
        items.map((item) => [item.program.clarisaId, item.program.code]),
      );
      const stored = await this.loads.countReturnedNotResubmitted(timeline.id);
      // FR-9, "the same counts": the query sees no round-2 row yet, but a result
      // this preview takes as re-submitted will have one when the sync ends, so
      // it is not counted. It leaves the count under its round-1 program and type.
      const returned: ReturnedNotResubmitted = {
        total: stored.total,
        byProgram: { ...stored.byProgram },
        byType: { ...stored.byType },
      };
      const leave = (counts: Record<string, number>, key: string) => {
        const left = (counts[key] ?? 0) - 1;
        if (left > 0) counts[key] = left;
        else delete counts[key];
      };
      for (const item of toLoad) {
        const take = takes.get(item.resultId);
        if (take?.kind !== 'resubmitted' || take.previous === null) continue;
        returned.total--;
        leave(returned.byProgram, String(take.previous.programClarisaId));
        leave(returned.byType, take.previous.resultTypeKey);
      }

      return {
        phaseYear: cycle.year,
        // The last step's closing minute is still open (FR-1).
        window:
          syncWindow(cycle.status, lastStep.closesAt, nowMinute) === 'open'
            ? 'open'
            : 'closed',
        round,
        stepPosition: step.position,
        toLoad: {
          total: toLoad.length,
          new: toLoad.length - resubmitted,
          resubmitted,
          byProgram: [...byProgram]
            .map(([programId, { code, count }]) => ({ programId, code, count }))
            .sort((a, b) => byNumber(a.programId, b.programId)),
          byResultType: [...byResultType]
            .map(([key, count]) => ({ key, count }))
            .sort((a, b) => a.key.localeCompare(b.key)),
        },
        returnedNotResubmitted: returnedView(returned, programCodes),
        kpGroups: kpGroupsView(groups),
        skipped: skippedView(skipped, otherTimelines),
      };
    });
  }

  /**
   * FR-2, design 7.2. The timeline (404), then one cheap list call to prove
   * Reporting answers (DD-13: a 503 with no row written), then the unit of
   * work, which refuses with a typed result and writes nothing. The runner
   * starts only after the commit and is not awaited.
   */
  start(ctx: AdminConfigContext, timelineId: number): Promise<StartedLoad> {
    return this.logged('start', ctx, timelineId, async () => {
      const now = this.clock();
      const timeline = await this.timelines.findById(timelineId);
      if (!timeline) throw new TimelineNotFoundError(timelineId);
      const cycle = await this.cycleOf(timeline);
      await this.reporting(cycle.year, () =>
        this.feed.list({ phaseYear: cycle.year, page: 1, pageSize: 1 }),
      );

      let result;
      try {
        result = await this.unitOfWork.start({
          cycleId: timeline.cycleId,
          timelineId,
          actorId: ctx.actorId,
          requestId: ctx.requestId,
          now,
          reservation: ctx.idempotency?.reservation,
        });
      } catch (error) {
        // A start that lost a deadlock was rolled back whole, and the load
        // that won the cycle is the one that is running.
        if (isDeadlock(error)) throw new LoadAlreadyRunningError();
        throw error;
      }
      if (result.kind === 'timeline_not_found') {
        throw new TimelineNotFoundError(timelineId);
      }
      if (result.kind === 'cycle_closed') throw new CycleClosedError();
      if (result.kind === 'window_closed') throw new LoadWindowClosedError();
      if (result.kind === 'already_running')
        throw new LoadAlreadyRunningError();

      // The load is committed: the run may begin. A failure to start it must
      // not turn a recorded load into an error; the lease ends it (FR-9).
      try {
        this.runner.run(result.loadId);
      } catch {
        this.logger.error(
          JSON.stringify({
            event: 'ingestion',
            route: 'start',
            timelineId,
            outcome: 'runner_error',
            requestId: ctx.requestId,
          }),
        );
      }
      return { id: result.loadId, status: 'running' };
    });
  }

  /** FR-10: the loads of a timeline, newest first, the lease applied. */
  list(ctx: AdminConfigContext, timelineId: number): Promise<LoadItem[]> {
    return this.logged('list', ctx, timelineId, async () => {
      const now = this.clock();
      if (!(await this.timelines.findById(timelineId))) {
        throw new TimelineNotFoundError(timelineId);
      }
      return (await this.loads.listByTimeline(timelineId)).map((row) =>
        loadItem(row, now),
      );
    });
  }

  /** FR-10: one load with its summary; the timeline is judged first, then the load. */
  get(
    ctx: AdminConfigContext,
    timelineId: number,
    loadId: number,
  ): Promise<LoadDetail> {
    return this.logged('get', ctx, timelineId, async () => {
      const now = this.clock();
      if (!(await this.timelines.findById(timelineId))) {
        throw new TimelineNotFoundError(timelineId);
      }
      const row = await this.loads.findLoad(timelineId, loadId);
      if (!row) throw new LoadNotFoundError(loadId);
      return { ...loadItem(row, now), summary: summaryView(row.load) };
    });
  }

  /**
   * The cycle of a timeline: its status and the year the feed is asked for.
   * No store method reads the cycle without a lock; on the pool the `FOR SHARE`
   * lasts only its own statement (as the timelines service does).
   */
  private async cycleOf(timeline: Timeline) {
    const cycle = await this.loads.lockCycleShared(timeline.cycleId);
    if (!cycle) throw new TimelineNotFoundError(timeline.id);
    return cycle;
  }

  /**
   * A Reporting call: unreachable or unauthorized (5xx, timeout, network, 401)
   * is a 503 (FR-2). A 404 means Reporting has no QA catalog for the cycle's
   * year: a 409 `LOADS_CATALOG_MISSING`, since the data, not the code, is wrong.
   * Any other 4xx Reporting refuses a well-formed call with is a defect on our
   * side, not an outage: it is left to surface as a 500, and the log line names
   * Reporting's status.
   */
  private async reporting<T>(year: number, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof FeedError && error.kind === 'rejected') {
        if (error.status === 404) throw new LoadCatalogMissingError(year);
        throw error;
      }
      if (error instanceof FeedError) throw new UpstreamUnavailableError();
      throw error;
    }
  }

  /** One `ingestion` line per request (design 7.8): ids and fixed words only. */
  private async logged<T>(
    route: LoadRoute,
    ctx: AdminConfigContext,
    timelineId: number,
    work: () => Promise<T>,
  ): Promise<T> {
    const line = (outcome: string, reason?: string) =>
      JSON.stringify({
        event: 'ingestion',
        route,
        timelineId,
        outcome,
        ...(reason === undefined ? {} : { reason }),
        requestId: ctx.requestId,
      });
    try {
      const result = await work();
      this.logger.log(line('ok'));
      return result;
    } catch (error) {
      const status = error instanceof HttpException ? error.getStatus() : 500;
      const body =
        error instanceof HttpException
          ? (error.getResponse() as { code?: unknown })
          : {};
      // A 4xx from Reporting that stays a 500 names Reporting's status, so
      // the line tells a defect of ours from a refusal upstream.
      const reason =
        typeof body.code === 'string' && /^[A-Z_]{1,64}$/.test(body.code)
          ? body.code
          : error instanceof FeedError && error.kind === 'rejected'
            ? `reporting_rejected_${error.status ?? 'unknown'}`
            : status < 500
              ? `http_${status}`
              : 'internal_error';
      if (status < 500) this.logger.warn(line('refused', reason));
      else this.logger.error(line('error', reason));
      throw error;
    }
  }
}
