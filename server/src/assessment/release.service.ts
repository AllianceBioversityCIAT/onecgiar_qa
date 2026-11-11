// @akili-spec assessment/step-1-assessment
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { CATALOG_TIMEOUT_MS } from '../users/catalogs/catalog-http.js';
import {
  ADMIN_CONFIG_CLOCK,
  type AdminConfigClock,
} from '../admin-config/admin-config.clock.js';
import {
  FeedError,
  RESULTS_FEED,
  type FeedRelease,
  type ResultsFeed,
} from '../ingestion/results-feed.port.js';
import {
  ASSESSMENT_UNIT_OF_WORK,
  type AssessmentUnitOfWork,
} from './assessment.unit-of-work.js';
import {
  RELEASE_STORE,
  type DueRelease,
  type ReleaseListItem,
  type ReleaseListStatus,
  type ReleaseStore,
} from './release.store.js';

export const RELEASE_DISPATCHER = Symbol('RELEASE_DISPATCHER');
/** The wait between two attempts of a send; tests replace it so no timer runs. */
export const RELEASE_PAUSE = Symbol('RELEASE_PAUSE');
export type ReleasePause = (ms: number) => Promise<void>;

export interface ReleaseDispatchResult {
  attempted: number;
  sent: number;
  refused: number;
  stillPending: number;
}

/** `maxRounds`: how many claim rounds (one send batch each) a call may run; the admin retry bounds it so the request cannot hang. */
export interface ReleaseDispatchOptions {
  maxRounds?: number;
}

/** What `AssessmentService` calls after an end commits (DD-5): never awaited by the request (NFR-6). */
export interface ReleaseDispatcher {
  dispatch(options?: ReleaseDispatchOptions): Promise<ReleaseDispatchResult>;
}

/** Items per release call and rows per claim (P-4: Reporting takes 1 to 50). */
export const RELEASE_BATCH = 50;
/** A claimed row is not due again for this long (design 7.6). */
export const RELEASE_LEASE_MS = 60 * 1000;
/** Three attempts per call, with this wait after the first and after the second (the runner's DD-8). */
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1000, 4000] as const;
const JITTER = 0.2;
/** The timeout of one feed call: the one `catalog-http.ts` gives every Reporting client (NFR-4), imported so the two cannot drift. */
const FEED_TIMEOUT_MS = CATALOG_TIMEOUT_MS;
/**
 * The longest ONE send can take: every attempt times out, and both waits are
 * spread 20 % up. A claim covers exactly one send batch, so this must stay
 * below the lease, or a second dispatcher could take rows still in flight.
 */
export const WORST_CASE_SEND_MS =
  MAX_ATTEMPTS * FEED_TIMEOUT_MS +
  BACKOFF_MS.reduce((sum, ms) => sum + ms, 0) * (1 + JITTER);
if (WORST_CASE_SEND_MS >= RELEASE_LEASE_MS) {
  throw new Error('release lease is shorter than the worst-case send');
}
/** A guard on one automatic `dispatch()`: 50 rounds of one batch. A leased row is not due again, so the loop ends long before it. */
const MAX_ROUNDS = 50;
/** The `reason` column holds 32 characters. */
const REASON_MAX = 32;

export const defaultReleasePause: ReleasePause = (baseMs) => {
  const spread = 1 + (Math.random() * 2 - 1) * JITTER;
  return new Promise((resolve) => {
    setTimeout(resolve, Math.round(baseMs * spread));
  });
};

/** `datetime` keeps whole seconds. */
const wholeSecond = (at: Date): Date =>
  new Date(Math.floor(at.getTime() / 1000) * 1000);

/** What Reporting decided for one row. */
type Decision =
  | { status: 'sent'; reason: string | null }
  | { status: 'refused'; reason: string };

/**
 * The release outbox (FR-18, NFR-3, NFR-6; design 7.6, DD-5). An end queues one
 * `pending` row in its own transaction; `dispatch()` claims the due rows with a
 * lease, sends them to Reporting after that commit, and acknowledges them, so a
 * failure never undoes an end and two dispatchers never send the same row.
 */
@Injectable()
export class ReleaseService implements ReleaseDispatcher {
  private readonly logger = new Logger(ReleaseService.name);
  private readonly pause: ReleasePause;

  constructor(
    @Inject(RELEASE_STORE) private readonly store: ReleaseStore,
    @Inject(RESULTS_FEED) private readonly feed: ResultsFeed,
    @Inject(ASSESSMENT_UNIT_OF_WORK)
    private readonly unitOfWork: AssessmentUnitOfWork,
    @Inject(ADMIN_CONFIG_CLOCK) private readonly clock: AdminConfigClock,
    @Optional() @Inject(RELEASE_PAUSE) pause?: ReleasePause,
  ) {
    this.pause = pause ?? defaultReleasePause;
  }

  /** The admin list (design 6): the `pending` or `refused` rows, oldest first. */
  list(status: ReleaseListStatus): Promise<ReleaseListItem[]> {
    return this.store.list(status);
  }

  /**
   * Sends every due row and acknowledges it. A round claims at most 50 rows and
   * sends it as one call (one phase year); rounds repeat until nothing is due (a row
   * that failed keeps its lease, so it is not taken again in this call). It
   * never throws: a failure leaves the rows `pending` and is logged.
   */
  async dispatch(
    options: ReleaseDispatchOptions = {},
  ): Promise<ReleaseDispatchResult> {
    const maxRounds = Math.min(options.maxRounds ?? MAX_ROUNDS, MAX_ROUNDS);
    const total: ReleaseDispatchResult = {
      attempted: 0,
      sent: 0,
      refused: 0,
      stillPending: 0,
    };
    for (let round = 0; round < maxRounds; round++) {
      let due: DueRelease[];
      try {
        // The store reads the clock inside its transaction: a wait for the pool is not taken from the lease.
        due = await this.store.claimDue(
          this.clock,
          RELEASE_LEASE_MS,
          RELEASE_BATCH,
        );
      } catch (error) {
        this.fail('claim_failed', error);
        break;
      }
      if (due.length === 0) break;
      total.attempted += due.length;
      // The lease must outlast a worst-case send. Past that point another dispatcher could take the rows while they are in flight and Reporting would get a second call: leave them pending, the lease runs out and the next sweep sends them.
      if (
        this.clock().getTime() >
        due[0]!.leaseUntil.getTime() - WORST_CASE_SEND_MS
      ) {
        this.log({
          outcome: 'lease_short',
          phaseYear: due[0]!.phaseYear,
          rows: due.length,
        });
        continue;
      }
      // One claim is one batch: one phase year, no result id twice (the store's contract).
      const settled = await this.sendAndAck(due[0]!.phaseYear, due);
      total.sent += settled.sent;
      total.refused += settled.refused;
    }
    total.stillPending = total.attempted - total.sent - total.refused;
    return total;
  }

  /** One batch of one phase year: the send with its retry, then the ack in one transaction. */
  private async sendAndAck(
    phaseYear: number,
    rows: DueRelease[],
  ): Promise<{ sent: number; refused: number }> {
    let answer: FeedRelease;
    try {
      answer = await this.send(phaseYear, rows);
    } catch (error) {
      // 401, 400 or the attempts used up: the rows stay `pending`, the lease runs out, the attempt count stays.
      this.log({
        outcome: 'send_failed',
        phaseYear,
        kind: error instanceof FeedError ? error.kind : 'error',
        rows: rows.length,
      });
      return { sent: 0, refused: 0 };
    }

    const decisions = decide(rows, answer);
    for (const row of rows) {
      if (!decisions.has(row.id)) {
        this.log({
          outcome: 'unanswered',
          releaseId: row.id,
          assessmentId: row.assessmentId,
        });
      }
    }
    const answered = rows.filter((row) => decisions.has(row.id));
    if (answered.length === 0) return { sent: 0, refused: 0 };

    try {
      return await this.acknowledge(answered, decisions);
    } catch {
      // Rolled back whole: the rows stay `pending`. The next send of an already released row answers `not_in_qa`, which counts as sent.
      this.log({ outcome: 'ack_failed', phaseYear, rows: answered.length });
      return { sent: 0, refused: 0 };
    }
  }

  /** `release` with the runner's retry: 5xx, timeout and network, 3 attempts, 1 s then 4 s. Anything else is thrown at once. */
  private async send(
    phaseYear: number,
    rows: readonly DueRelease[],
  ): Promise<FeedRelease> {
    const query = {
      phaseYear,
      items: rows.map((row) => ({
        resultId: row.resultId,
        outcome: row.outcome,
      })),
    };
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.feed.release(query);
      } catch (error) {
        const retryable =
          error instanceof FeedError && error.kind === 'unavailable';
        if (!retryable || attempt >= MAX_ATTEMPTS) throw error;
        await this.pause(BACKOFF_MS[attempt - 1]!);
      }
    }
  }

  /**
   * The ack of a batch, ONE transaction, in the lock order of design 5: every
   * timeline row `FOR SHARE` (by id), then each assessment row `FOR UPDATE` (by
   * id), then the release row, the membership end and the audit row. The
   * membership is ended only here, after Reporting acknowledged (FR-18).
   */
  private async acknowledge(
    rows: readonly DueRelease[],
    decisions: ReadonlyMap<number, Decision>,
  ): Promise<{ sent: number; refused: number }> {
    const at = wholeSecond(this.clock());
    const logs: Array<Record<string, string | number>> = [];
    // Why a membership did not end (`already_ended`, `not_round_1`) or why no audit row was written (`no_actor`): a reason word on the log line.
    const endNotes = new Map<number, string>();
    const counts = await this.unitOfWork.run(
      async ({ assessments, releases, loads }) => {
        logs.length = 0;
        endNotes.clear();
        let sent = 0;
        let refused = 0;
        const timelineIds = [
          ...new Set(rows.map((row) => row.timelineId)),
        ].sort((a, b) => a - b);
        for (const timelineId of timelineIds) {
          await assessments.lockTimelineShared(timelineId);
        }
        for (const row of [...rows].sort(
          (a, b) => a.assessmentId - b.assessmentId,
        )) {
          const decision = decisions.get(row.id)!;
          const locked = await releases.lockAssessment(row.assessmentId);
          if (locked === undefined) continue;
          const settled = await releases.settle({
            id: row.id,
            status: decision.status,
            reason: decision.reason,
            at,
          });
          // Another dispatcher acknowledged it first (a lease that ran out): nothing more to write.
          if (!settled) continue;
          if (decision.status === 'sent') {
            // Both are conditional updates: an ended membership keeps its first instant and reason.
            const end =
              row.outcome === 'qaed'
                ? await loads.endAsReleasedQaed(row.timelineResultId, at)
                : await loads.endAsReturned(row.timelineResultId, at);
            if (!end.ended) endNotes.set(row.id, end.reason);
            sent += 1;
          } else {
            refused += 1;
          }
          // The release is an effect of the end, so its actor is whoever ended the assessment (the audit actor is never null).
          if (locked.finishedBy === null) {
            endNotes.set(
              row.id,
              [endNotes.get(row.id), 'no_actor'].filter(Boolean).join(' '),
            );
          } else {
            await assessments.insertAudit({
              assessmentId: row.assessmentId,
              actorId: locked.finishedBy,
              action:
                decision.status === 'sent' ? 'release_sent' : 'release_refused',
              fieldKeys: null,
              commentId: null,
              requestId: `release-${row.id}`,
              at,
            });
          }
          logs.push({
            outcome: decision.status,
            releaseId: row.id,
            assessmentId: row.assessmentId,
            ...(decision.reason === null ? {} : { reason: decision.reason }),
            ...(endNotes.has(row.id) ? { note: endNotes.get(row.id)! } : {}),
          });
        }
        return { sent, refused };
      },
    );
    // Logged after the commit: a rolled-back (or retried) transaction logs nothing.
    for (const line of logs) this.log(line);
    return counts;
  }

  /** The fixed `assessment_release` line: ids, counts and fixed words only (NFR-5). */
  private log(fields: Record<string, string | number>): void {
    const level =
      fields.outcome === 'sent' || fields.outcome === 'refused'
        ? 'log'
        : 'warn';
    this.logger[level](
      JSON.stringify({ event: 'assessment_release', ...fields }),
    );
  }

  private fail(outcome: string, error: unknown): void {
    this.log({
      outcome,
      kind: error instanceof FeedError ? error.kind : 'error',
    });
  }
}

/**
 * What Reporting's answer means for each row (design 7.6 step 3, P-4):
 * `released` and `not_in_qa` (the answer to a repeated release) are sent; any
 * other reason is a refusal, whatever its word (the list grows additively). A
 * row Reporting did not answer has no decision and stays pending.
 */
function decide(
  rows: readonly DueRelease[],
  answer: FeedRelease,
): Map<number, Decision> {
  const released = new Set(answer.released.map((item) => item.resultId));
  const notReleased = new Map(
    answer.notReleased.map((item) => [item.resultId, item.reason]),
  );
  const decisions = new Map<number, Decision>();
  for (const row of rows) {
    const reason = notReleased.get(row.resultId);
    if (released.has(row.resultId)) {
      decisions.set(row.id, { status: 'sent', reason: null });
    } else if (reason === 'not_in_qa') {
      decisions.set(row.id, { status: 'sent', reason });
    } else if (reason !== undefined) {
      decisions.set(row.id, {
        status: 'refused',
        reason: reason.slice(0, REASON_MAX),
      });
    }
  }
  return decisions;
}
