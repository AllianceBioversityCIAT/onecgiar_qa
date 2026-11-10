// @akili-spec ingestion/step-1-loads
// @akili-spec ingestion/timeline-sync
// @akili-spec assessment/step-1-assessment
import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  ADMIN_CONFIG_CLOCK,
  type AdminConfigClock,
} from '../admin-config/admin-config.clock.js';
import { nowInRome } from '../admin-config/rome-date.js';
import {
  FIELD_CATALOG_SOURCE,
  FieldCatalogMissingError,
  type FieldCatalogSource,
} from '../admin-config/field-config/field-catalog.ports.js';
import { snapshotSortSuffix } from '../database/dynamodb/entities/result-snapshot.entity.js';
import type {
  TimelineLoad,
  TimelineLoadFailureReason,
} from '../database/drizzle/schema/timeline-loads.js';
import { UpstreamStatusError } from '../users/catalogs/catalog-http.js';
import { UpstreamUnavailableError } from '../users/catalogs/catalogs.errors.js';
import { listEveryPage } from './feed-paging.js';
import {
  KP_RULES,
  type KpRules,
  type ResultClassification,
} from './kp-classifier.js';
import {
  canonicalJson,
  changedFields,
  skipVerdict,
  SNAPSHOT_SK_PREFIX,
  snapshotKeyOf,
  type LoadSummary,
  type TakeVerdict,
} from './load-rules.js';
import type { LoadRunnerPort } from './loads.service.js';
import {
  LOADS_STORE,
  TimelineHasNoStepsError,
  type CycleMembershipRow,
  type LoadsStore,
} from './loads.store.js';
import {
  LoadsUnitOfWork,
  type LotMembership,
  type RecordLotResult,
} from './loads.unit-of-work.js';
import {
  FeedError,
  RESULTS_FEED,
  type FeedDetailsResult,
  type FeedListItem,
  type FeedListQuery,
  type ReleaseOutcome,
  type ResultsFeed,
} from './results-feed.port.js';
import {
  SNAPSHOT_STORE,
  SnapshotConflictError,
  type ResultSnapshotRecord,
  type SnapshotStore,
} from './snapshot-store.port.js';

/**
 * Whether a completed load releases its auto-checked and not-in-QA KPs to
 * Reporting as `qaed` (FR-14, S-8). ON since 2026-11-04 (back lead): those KPs
 * are not assessed, so they must not stay locked In QA in Reporting.
 */
export const KP_RELEASE_ENABLED = true;

/** The KP release setting as a provider (default `KP_RELEASE_ENABLED`); a test turns it on without touching the constant. */
export const KP_RELEASE_SETTING = Symbol('KP_RELEASE_SETTING');

/** A lot is up to 50 results (FR-3). */
const LOT_SIZE = 50;
/** Snapshot puts in flight at once (design 7.3 step 2.5). */
const SNAPSHOT_PARALLELISM = 10;
/** Release items per call, as the lots of the other calls. */
const RELEASE_LOT = 50;
/** Three attempts, with this wait after the first and after the second (DD-8). */
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1000, 4000] as const;
/** The wait is spread by this share either way (DD-8). */
const JITTER = 0.2;
/** The timer renews the heartbeat this often while the run is alive (FR-9). */
export const HEARTBEAT_INTERVAL_MS = 60 * 1000;

type CallKind = 'reporting' | 'store';

/** The end of a run that cannot go on, with the typed reason the load keeps (design 5.1). */
class RunFailure extends Error {
  constructor(
    readonly reason: TimelineLoadFailureReason,
    override readonly cause?: unknown,
  ) {
    super(reason);
    this.name = 'RunFailure';
  }
}

/** What one run keeps between its lots. Nothing here is shared between runs. */
interface Run {
  load: TimelineLoad;
  /** The load is no longer `running`: abandoned, or ended elsewhere. The run writes nothing more. */
  lost: boolean;
  /** QA's copy of the catalog version for the load's phase year (design 7.3 step 1). */
  catalogVersion: string;
  /** One forced catalog refresh per load (design 7.3 step 2.3). */
  catalogRefreshed: boolean;
  /** The KPs a completed load would release, collected only while the release is on. */
  releasable: Array<{ resultId: number; outcome: ReleaseOutcome }>;
}

/** A take of the verdict: what the lot does with a result that was not skipped. */
type Take = TakeVerdict<CycleMembershipRow>;

const sum = (counts: Record<string, number>): number =>
  Object.values(counts).reduce((total, count) => total + count, 0);

const hashValues = (values: Record<string, unknown>): string =>
  createHash('sha256').update(canonicalJson(values)).digest('hex');

/** The longest title the `timeline_results.title` column holds, in characters (`varchar(1000)`). */
const TITLE_MAX_CHARACTERS = 1000;

// @akili-spec assessment/step-1-assessment
/**
 * FR-24, design 7.8: the membership's title is the string `general.title` of
 * the details, cut to 1,000 characters; anything else (absent, a number, an
 * object, null) is null. Cut by character, not by UTF-16 unit, so a cut never
 * leaves half of an emoji for the column to refuse.
 */
function titleOf(values: Record<string, unknown>): string | null {
  const title = values['general.title'];
  if (typeof title !== 'string') return null;
  if (title.length <= TITLE_MAX_CHARACTERS) return title;
  return Array.from(title).slice(0, TITLE_MAX_CHARACTERS).join('');
}

/**
 * The run of a started load (design 7.3). `run` returns at once and records its
 * own end: every failure becomes the load's `failed` state and its `load_end`
 * row, and nothing escapes as an unhandled rejection.
 *
 * Per lot of 50, in feed order: the verdict of each result (memberships read,
 * the expired ones of other timelines ended; skip, new or re-submitted, by the
 * load's round), intake of the takes, details of the taken ones, the catalog
 * check, the KP rule (not for a re-submitted result of the same type), the
 * changed fields (a snapshot read only when the hash and the type say so), the
 * snapshots (at most 10 at once), then the memberships and the progress in one
 * transaction (`recordLot`). At the end of the run, completed or failed, the
 * returned results not resubmitted are counted once into the summary. The snapshot
 * is written BEFORE its membership (DD-4), so a failed lot leaves orphan
 * snapshots and never a membership without one; the retry of the lot writes the
 * same keys with the same hash, which the store accepts.
 *
 * Retries (DD-8): every Reporting call and every store write is tried 3 times,
 * waiting 1 s and then 4 s, each spread 20 % either way. A 4xx is never retried
 * (401 is `REPORTING_UNAUTHORIZED`, any other is `REPORTING_REJECTED`). A timer
 * renews `heartbeat_at` every 60 s while the run is alive (FR-9), so a lot that
 * waits on its backoff never looks abandoned. Logs carry ids and counts only:
 * never the Reporting key, a header, a title or a person field (NFR-1, NFR-2).
 */
@Injectable()
export class LoadRunner implements LoadRunnerPort {
  private readonly logger = new Logger(LoadRunner.name);
  private readonly releaseKp: boolean;

  constructor(
    @Inject(LoadsUnitOfWork) private readonly unitOfWork: LoadsUnitOfWork,
    @Inject(LOADS_STORE) private readonly loads: LoadsStore,
    @Inject(RESULTS_FEED) private readonly feed: ResultsFeed,
    @Inject(SNAPSHOT_STORE) private readonly snapshots: SnapshotStore,
    @Inject(FIELD_CATALOG_SOURCE) private readonly catalogs: FieldCatalogSource,
    @Inject(KP_RULES) private readonly kpRules: KpRules,
    @Inject(ADMIN_CONFIG_CLOCK) private readonly clock: AdminConfigClock,
    @Optional()
    @Inject(KP_RELEASE_SETTING)
    releaseKp?: boolean,
  ) {
    this.releaseKp = releaseKp ?? KP_RELEASE_ENABLED;
  }

  /** Fire and forget: the promise is handled here, so a failure never escapes. */
  run(loadId: number): void {
    this.execute(loadId).catch((error: unknown) => {
      this.log('error', loadId, 'run_error', {
        error: error instanceof Error ? error.name : 'unknown',
      });
    });
  }

  private async execute(loadId: number): Promise<void> {
    let run: Run | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
      const load = await this.store(loadId, () =>
        this.loads.findLoadById(loadId),
      );
      if (!load) {
        this.log('warn', loadId, 'load_not_found');
        return;
      }
      if (load.status !== 'running') {
        this.log('warn', loadId, 'load_not_running');
        return;
      }
      const started: Run = {
        load,
        lost: false,
        catalogVersion: '',
        catalogRefreshed: false,
        releasable: [],
      };
      run = started;
      // The heartbeat is renewed apart from the lots (FR-9): the listing and
      // the backoffs can take longer than a minute.
      timer = setInterval(() => void this.beat(started), HEARTBEAT_INTERVAL_MS);
      await this.process(started);
    } catch (error) {
      await this.fail(loadId, run, error);
    } finally {
      clearInterval(timer);
    }
  }

  // --- the run ---------------------------------------------------------------

  private async process(run: Run): Promise<void> {
    const { load } = run;
    const query: Omit<FeedListQuery, 'page' | 'pageSize'> = {
      phaseYear: load.phaseYear,
      // The scope read at start, never the timeline's current one (FR-3); an
      // "all" flag sends no filter.
      ...(load.scope.allPrograms ? {} : { programIds: load.scope.programIds }),
      ...(load.scope.allResultTypes
        ? {}
        : { resultTypeKeys: load.scope.resultTypeKeys }),
    };
    const items = await listEveryPage(
      { list: (q) => this.reporting(load.id, () => this.feed.list(q)) },
      query,
    );
    if (
      !(await this.store(load.id, () =>
        this.unitOfWork.setTotal(load.id, items.length),
      ))
    ) {
      return this.lose(run);
    }
    const catalog = await this.reporting(load.id, () =>
      this.catalogs.forYear(load.phaseYear),
    );
    run.catalogVersion = catalog.catalogVersion;

    // A code the listing carries twice is skipped every time (DD-11).
    const listed = new Map<number, number>();
    for (const item of items) {
      listed.set(item.resultCode, (listed.get(item.resultCode) ?? 0) + 1);
    }

    for (let at = 0; at < items.length; at += LOT_SIZE) {
      if (run.lost) return;
      await this.runLot(
        run,
        items.slice(at, at + LOT_SIZE),
        listed,
        at / LOT_SIZE + 1,
      );
    }
    if (run.lost) return;

    // Design 7.3 step 3: with the KP release off, `release` is never called.
    if (this.releaseKp) await this.release(run);
    // Design 7.3 step 7: the end counts the returned results itself, from QA's
    // own rows and inside its transaction (DD-7; step-1-assessment FR-24,
    // design 7.8): a count read here, before it, could be stale at the commit.
    const ended = await this.store(load.id, () =>
      this.unitOfWork.end({
        loadId: load.id,
        status: 'completed',
        now: this.clock(),
      }),
    );
    if (ended.kind !== 'ended') return this.lose(run);
    this.log('log', load.id, 'completed', {
      round: load.round,
      lots: Math.ceil(items.length / LOT_SIZE),
    });
  }

  private async runLot(
    run: Run,
    lot: FeedListItem[],
    listed: ReadonlyMap<number, number>,
    lotNumber: number,
  ): Promise<void> {
    const { load } = run;
    const now = this.clock();

    // 2.1 Skips. The memberships of the lot in the cycle; the expired ones of
    // other timelines end first (DD-5), so the insert never meets them.
    const memberships = await this.store(load.id, () =>
      this.loads.findMemberships(
        load.cycleId,
        lot.map((item) => item.resultCode),
      ),
    );
    // A run that learned its load is not running writes nothing more.
    if (run.lost) return;
    await this.store(load.id, () =>
      this.unitOfWork.endExpired({
        timelineId: load.timelineId,
        memberships,
        now,
      }),
    );

    const held = new Map<number, CycleMembershipRow[]>();
    for (const row of memberships) {
      held.set(row.resultCode, [...(held.get(row.resultCode) ?? []), row]);
    }
    const skipped: Record<string, number> = {};
    const otherTimelines: LoadSummary['otherTimelines'] = {};
    const count = (reason: string) => {
      skipped[reason] = (skipped[reason] ?? 0) + 1;
    };
    const candidates: FeedListItem[] = [];
    const takes = new Map<number, Take>();
    for (const item of lot) {
      const rows = held.get(item.resultCode) ?? [];
      const verdict = skipVerdict({
        round: load.round,
        timelineId: load.timelineId,
        now: nowInRome(now),
        submittedAt: item.submittedAt,
        memberships: rows,
        duplicated: (listed.get(item.resultCode) ?? 0) > 1,
      });
      if (!('reason' in verdict)) {
        candidates.push(item);
        takes.set(item.resultId, verdict);
        continue;
      }
      count(verdict.reason);
      // FR-14: a KP already in this timeline that a failed load never
      // released (Reporting down at the release) is released again by the
      // re-run. Reporting answers `not_released` for one already released.
      if (this.releaseKp && verdict.reason === 'ALREADY_IN_THIS_TIMELINE') {
        const own = rows.find(
          (row) => row.timelineId === load.timelineId && row.endedAt === null,
        );
        if (
          own &&
          (own.status === 'auto_validated' || own.status === 'not_in_qa')
        ) {
          run.releasable.push({ resultId: own.resultId, outcome: 'qaed' });
        }
      }
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

    // 2.2 Intake of the rest, always before their details (FR-3). A result
    // intake refuses is a skip with Reporting's reason as given.
    let taken: FeedListItem[] = [];
    if (candidates.length > 0) {
      const intake = await this.reporting(load.id, () =>
        this.feed.intake({
          phaseYear: load.phaseYear,
          resultIds: candidates.map((item) => item.resultId),
        }),
      );
      const takenIds = new Set(intake.taken.map((entry) => entry.resultId));
      for (const entry of intake.notTaken) count(entry.reason);
      taken = candidates.filter((item) => takenIds.has(item.resultId));
    }

    // 2.3 Details of the taken ones only (never of a skipped or refused one).
    // Every key is asked for: S-10 excludes none yet (DD-10, Q3 open).
    const detailed: Array<{
      item: FeedListItem;
      result: FeedDetailsResult;
      take: Take;
    }> = [];
    let catalogVersion = run.catalogVersion;
    if (taken.length > 0) {
      const details = await this.reporting(load.id, () =>
        this.feed.details({
          phaseYear: load.phaseYear,
          resultIds: taken.map((item) => item.resultId),
        }),
      );
      for (const entry of details.notEligible) count(entry.reason);
      await this.checkCatalog(run, details.catalogVersion);
      catalogVersion = details.catalogVersion;
      const byId = new Map(details.results.map((r) => [r.resultId, r]));
      for (const item of taken) {
        const result = byId.get(item.resultId);
        const take = takes.get(item.resultId);
        if (result && take) detailed.push({ item, result, take });
      }
    }

    // 2.4 Classify, 2.5 snapshots (the keys and the hash are fixed by the
    // load, so a retry writes the same items).
    const loadedAt = load.startedAt.toISOString();
    const planned = detailed.map(({ item, result, take }) => {
      const classification = this.classify(take, result);
      const hash = hashValues(result.values);
      const snapshotSk = `${SNAPSHOT_SK_PREFIX}${snapshotSortSuffix({
        phaseYear: load.phaseYear,
        cycleId: load.cycleId,
        timelineId: load.timelineId,
        loadId: load.id,
      })}`;
      const snapshot: ResultSnapshotRecord = {
        resultCode: item.resultCode,
        resultId: item.resultId,
        phaseYear: load.phaseYear,
        cycleId: load.cycleId,
        timelineId: load.timelineId,
        loadId: load.id,
        resultTypeKey: result.resultTypeKey,
        programClarisaId: item.program.clarisaId,
        catalogVersion,
        hash,
        loadedAt,
        values: result.values,
        ...(result.labels ? { labels: result.labels } : {}),
      };
      const membership: LotMembership = {
        resultCode: item.resultCode,
        resultId: item.resultId,
        programClarisaId: item.program.clarisaId,
        resultTypeKey: result.resultTypeKey,
        status: classification.status,
        kpGroup: classification.kpGroup,
        awaitsStep: classification.awaitsStep,
        snapshotSk,
        snapshotHash: hash,
        catalogVersion,
        kind: take.kind,
        previousMembershipId: take.previous?.id ?? null,
        // Filled below, once the comparison is done (null without a previous).
        changedFields: null,
        title: titleOf(result.values),
      };
      return { snapshot, membership, previous: take.previous };
    });

    // 2.4b Changed fields (FR-8), before any snapshot is written: a missing
    // earlier item fails the lot here, with nothing of it recorded.
    await this.compareWithPrevious(load.id, planned);

    // 2.5 and 2.6 are one retriable unit: if the memberships fail after the
    // snapshots were written, the retry writes the same keys and the same hash,
    // which the store takes as done (FR-6, retry of a lot).
    const recorded: RecordLotResult = await this.store(load.id, async () => {
      await this.putSnapshots(planned.map((entry) => entry.snapshot));
      return this.unitOfWork.recordLot({
        loadId: load.id,
        memberships: planned.map((entry) => entry.membership),
        processed: lot.length,
        skips: { skipped, otherTimelines },
        now: this.clock(),
      });
    });
    if (recorded.kind !== 'recorded') return this.lose(run);

    if (this.releaseKp) {
      const inserted = new Set(recorded.insertedCodes);
      for (const { membership } of planned) {
        if (
          inserted.has(membership.resultCode) &&
          (membership.status === 'auto_validated' ||
            membership.status === 'not_in_qa')
        ) {
          run.releasable.push({
            resultId: membership.resultId,
            outcome: 'qaed',
          });
        }
      }
    }
    this.log('log', load.id, 'lot', {
      round: load.round,
      lot: lotNumber,
      size: lot.length,
      loaded: recorded.insertedCodes.length,
      skipped: sum(skipped) + recorded.raceSkips.length,
    });
  }

  /**
   * Design 7.3 step 4. A new result is classified as in step 1. A re-submitted
   * one of the same type keeps its round-1 KP group and is `pending`, never
   * re-classified, so the KP release can never take it (S-9 a, DD-4). One whose
   * type changed is classified by its new type: an output is `pending` with no
   * group (S-9 b) and a KP is classified as a new one (S-9 c).
   */
  private classify(
    take: Take,
    result: FeedDetailsResult,
  ): ResultClassification {
    if (
      take.kind === 'resubmitted' &&
      take.previous !== null &&
      take.previous.resultTypeKey === result.resultTypeKey
    ) {
      return {
        status: 'pending',
        kpGroup: take.previous.kpGroup,
        awaitsStep: null,
      };
    }
    return this.kpRules.classify({
      resultTypeKey: result.resultTypeKey,
      values: result.values,
    });
  }

  /**
   * Design 7.3 step 5, FR-8: the keys that changed since the earlier membership
   * of the code. The same hash is `[]` and a changed type is `['result_type_key']`,
   * neither reading DynamoDB; any other is one GetItem of the earlier snapshot
   * (at most 10 at once). A missing earlier item is `INTERNAL`: never a silent null.
   */
  private async compareWithPrevious(
    loadId: number,
    planned: Array<{
      snapshot: ResultSnapshotRecord;
      membership: LotMembership;
      previous: CycleMembershipRow | null;
    }>,
  ): Promise<void> {
    const compared = planned.filter((entry) => entry.previous !== null);
    for (let at = 0; at < compared.length; at += SNAPSHOT_PARALLELISM) {
      await Promise.all(
        compared.slice(at, at + SNAPSHOT_PARALLELISM).map(async (entry) => {
          const previous = entry.previous!;
          const { snapshot, membership } = entry;
          if (previous.snapshotHash === snapshot.hash) {
            membership.changedFields = [];
          } else if (previous.resultTypeKey !== snapshot.resultTypeKey) {
            membership.changedFields = ['result_type_key'];
          } else {
            const earlier = await this.store(loadId, () =>
              this.snapshots.get(
                snapshot.resultCode,
                snapshotKeyOf(previous.snapshotSk),
              ),
            );
            const values: unknown = earlier?.values;
            if (
              typeof values !== 'object' ||
              values === null ||
              Array.isArray(values)
            ) {
              throw new RunFailure(
                'INTERNAL',
                new Error('The earlier snapshot is missing'),
              );
            }
            membership.changedFields = changedFields(
              values as Record<string, unknown>,
              snapshot.values,
            );
          }
        }),
      );
    }
  }

  /**
   * Design 7.3 step 2.3: a `catalog_version` that is not QA's copy forces ONE
   * refresh for the load; a second difference fails the load. After a refresh
   * that matches, the new version is QA's copy for the lots that follow.
   */
  private async checkCatalog(run: Run, detailsVersion: string): Promise<void> {
    if (detailsVersion === run.catalogVersion) return;
    if (run.catalogRefreshed) throw new RunFailure('CATALOG_VERSION_MISMATCH');
    run.catalogRefreshed = true;
    const { phaseYear } = run.load;
    const fresh = await this.reporting(run.load.id, () =>
      this.catalogs.refresh
        ? this.catalogs.refresh(phaseYear)
        : this.catalogs.forYear(phaseYear),
    );
    run.catalogVersion = fresh.catalogVersion;
    if (fresh.catalogVersion !== detailsVersion) {
      throw new RunFailure('CATALOG_VERSION_MISMATCH');
    }
  }

  /** At most 10 puts at once (design 7.3 step 2.5). */
  private async putSnapshots(snapshots: ResultSnapshotRecord[]): Promise<void> {
    for (let at = 0; at < snapshots.length; at += SNAPSHOT_PARALLELISM) {
      await Promise.all(
        snapshots
          .slice(at, at + SNAPSHOT_PARALLELISM)
          .map((snapshot) => this.snapshots.put(snapshot)),
      );
    }
  }

  /** FR-14: only reached when the release setting is on. */
  private async release(run: Run): Promise<void> {
    for (let at = 0; at < run.releasable.length; at += RELEASE_LOT) {
      await this.reporting(run.load.id, () =>
        this.feed.release({
          phaseYear: run.load.phaseYear,
          items: run.releasable.slice(at, at + RELEASE_LOT),
        }),
      );
    }
  }

  // --- the heartbeat -----------------------------------------------------------

  private async beat(run: Run): Promise<void> {
    try {
      const alive = await this.unitOfWork.heartbeat(run.load.id, this.clock());
      if (!alive) this.lose(run);
    } catch (error) {
      // One missed beat is covered by the lease (5 min against 60 s).
      this.log('warn', run.load.id, 'heartbeat_failed', {
        error: error instanceof Error ? error.name : 'unknown',
      });
    }
  }

  private lose(run: Run): void {
    if (run.lost) return;
    run.lost = true;
    this.log('warn', run.load.id, 'load_not_running');
  }

  // --- the end of a failed run ---------------------------------------------------

  /** A failure sets `failed`, its reason and the `load_end` row; what earlier lots recorded stays (FR-8). */
  private async fail(
    loadId: number,
    run: Run | undefined,
    error: unknown,
  ): Promise<void> {
    const reason: TimelineLoadFailureReason =
      error instanceof RunFailure ? error.reason : 'INTERNAL';
    const cause = error instanceof RunFailure ? error.cause : error;
    if (cause instanceof TimelineHasNoStepsError) {
      this.log('error', loadId, 'corrupt_timeline', {
        timelineId: cause.timelineId,
      });
    }
    this.log('error', loadId, 'failed', {
      ...(run ? { round: run.load.round } : {}),
      reason,
      ...(reason === 'INTERNAL' && cause instanceof Error
        ? { error: cause.name }
        : {}),
    });
    // A run that learned its load is not running must not end it again.
    if (run?.lost) return;
    try {
      // Design 7.3 step 7: the end counts at a failed end too, in its own
      // transaction (step-1-assessment FR-24).
      const ended = await this.store(loadId, () =>
        this.unitOfWork.end({
          loadId,
          status: 'failed',
          failureReason: reason,
          now: this.clock(),
        }),
      );
      if (ended.kind !== 'ended') this.log('warn', loadId, 'load_not_running');
    } catch {
      // The store is down for the end too: the lease will read the load as ABANDONED (FR-9).
      this.log('error', loadId, 'end_not_written');
    }
  }

  // --- retries (DD-8) -----------------------------------------------------------

  private reporting<T>(loadId: number, work: () => Promise<T>): Promise<T> {
    return this.attempt(loadId, 'reporting', work);
  }

  private store<T>(loadId: number, work: () => Promise<T>): Promise<T> {
    return this.attempt(loadId, 'store', work);
  }

  /**
   * 3 attempts with 1 s then 4 s between them, each wait spread 20 % either
   * way. Only a 5xx, a timeout, a network error or a store error is retried;
   * anything else ends the run at once with its typed reason.
   */
  private async attempt<T>(
    loadId: number,
    kind: CallKind,
    work: () => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await work();
      } catch (error) {
        const verdict = this.judge(kind, error);
        if (verdict !== 'retry') throw verdict;
        if (attempt >= MAX_ATTEMPTS) {
          throw new RunFailure(
            kind === 'reporting'
              ? 'REPORTING_UNAVAILABLE'
              : 'STORE_UNAVAILABLE',
            error,
          );
        }
        this.log('warn', loadId, 'retry', { kind, attempt });
        await this.pause(BACKOFF_MS[attempt - 1]!);
      }
    }
  }

  private judge(kind: CallKind, error: unknown): 'retry' | RunFailure {
    if (error instanceof RunFailure) return error;
    // The store refused the content, or the data is corrupt: no retry can help.
    if (
      error instanceof SnapshotConflictError ||
      error instanceof TimelineHasNoStepsError
    ) {
      return new RunFailure('INTERNAL', error);
    }
    if (kind === 'store') return 'retry';
    if (error instanceof FeedError) {
      if (error.kind === 'unauthorized') {
        return new RunFailure('REPORTING_UNAUTHORIZED', error);
      }
      if (error.kind === 'rejected') {
        return new RunFailure('REPORTING_REJECTED', error);
      }
      return 'retry';
    }
    // The catalog of the load's year. A non-2xx is an `UpstreamStatusError`,
    // which IS an `UpstreamUnavailableError`, so its status is read first: a 4xx
    // is never retried (FR-8), only a 5xx is.
    if (error instanceof UpstreamStatusError) {
      if (error.httpStatus === 401) {
        return new RunFailure('REPORTING_UNAUTHORIZED', error);
      }
      if (error.httpStatus >= 400 && error.httpStatus < 500) {
        return new RunFailure('REPORTING_REJECTED', error);
      }
      return 'retry';
    }
    // Down (timeout, network, bad body) is retried; none for the year is a refusal.
    if (error instanceof UpstreamUnavailableError) return 'retry';
    if (error instanceof FieldCatalogMissingError) {
      return new RunFailure('REPORTING_REJECTED', error);
    }
    return new RunFailure('INTERNAL', error);
  }

  private pause(baseMs: number): Promise<void> {
    const spread = 1 + (Math.random() * 2 - 1) * JITTER;
    return new Promise((resolve) => {
      setTimeout(resolve, Math.round(baseMs * spread));
    });
  }

  // --- logs ------------------------------------------------------------------------

  /** One `ingestion` line: ids, counts and fixed words only (design 7.8). */
  private log(
    level: 'log' | 'warn' | 'error',
    loadId: number,
    outcome: string,
    extra: Record<string, string | number> = {},
  ): void {
    this.logger[level](
      JSON.stringify({
        event: 'ingestion',
        route: 'run',
        loadId,
        outcome,
        ...extra,
      }),
    );
  }
}
