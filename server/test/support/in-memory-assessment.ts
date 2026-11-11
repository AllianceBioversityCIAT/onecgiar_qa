// @akili-spec assessment/step-1-assessment
import type { TimelineLoads } from '../../src/admin-config/timelines/timeline-loads.js';
import type { ResultAssessmentStatus } from '../../src/database/drizzle/schema/result-assessments.js';
import type { CommentState } from '../../src/database/drizzle/schema/assessment-comments.js';
import type {
  TimelineResultEndReason,
  TimelineResultStatus,
} from '../../src/database/drizzle/schema/timeline-results.js';
import type { CycleStatus } from '../../src/database/drizzle/schema/cycles.js';
import type { TimelineKind } from '../../src/database/drizzle/schema/timelines.js';
import { statusOf, type QaStatus } from '../../src/assessment/qa-status.js';
import {
  inScope,
  listedFor,
  type MembershipFacts,
} from '../../src/assessment/scope.js';
import type {
  WorklistPageCriteria,
  WorklistRecord,
  WorklistScope,
  WorklistStatusCount,
  WorklistStep,
  WorklistStore,
  WorklistTimeline,
} from '../../src/assessment/worklist.store.js';
import type { RomeMinute } from '../../src/admin-config/rome-date.js';
import {
  FieldConfigNoVersionError,
  TimelineNotFoundError,
} from '../../src/admin-config/admin-config.errors.js';
import type { ConfigItem } from '../../src/admin-config/field-config/field-config-diff.js';
import type {
  EffectiveFieldConfig,
  FieldConfigEffective,
} from '../../src/admin-config/field-config/field-config.module.js';
import type {
  AssessmentEndWrite,
  AssessmentStore,
  AssessmentWriteStore,
  AuditEventWrite,
  CommentContext,
  CommentEventWrite,
  CommentRecord,
  LockedAssessment,
  MembershipCriteria,
  MembershipRecord,
  NewAssessmentRow,
  NewCommentRow,
  NewQuickCommentRow,
  NewReleaseRow,
  QuickCommentRecord,
  SavedQuickComment,
  ValidationRecord,
  ValidationWrite,
} from '../../src/assessment/assessment.store.js';
import type {
  AssessmentRepositories,
  AssessmentUnitOfWork,
} from '../../src/assessment/assessment.unit-of-work.js';
import type { ReleaseDispatcher } from '../../src/assessment/release.service.js';
import type {
  DueRelease,
  LockedReleaseAssessment,
  ReleaseListItem,
  ReleaseListStatus,
  ReleaseSettle,
  ReleaseStore,
  ReleaseWriteStore,
} from '../../src/assessment/release.store.js';
import type {
  EndAsReleasedQaedOutcome,
  EndAsReturnedOutcome,
} from '../../src/ingestion/loads.store.js';
import type {
  IdempotencyStore,
  Reservation,
} from '../../src/common/idempotency/idempotency.store.js';

// The worklist port over plain rows, with the semantics of the Drizzle adapter:
// the scope is the T-3 predicate (`listedFor`), the status is `statusOf`, the
// order is (sort value, result code ascending) with a keyset. Every port call is
// one statement and is counted, so a spec can pin NFR-1 (a call per row in a
// loop shows as a count that grows with the data).

export interface FakeTimeline {
  id: number;
  cycleId?: number;
  /** Status of the timeline's cycle; the worklist reads the active cycle only. Default `active`. */
  cycleStatus?: CycleStatus;
  /** Year of the timeline's cycle, the catalog year of the view. Default 2026. */
  cycleYear?: number;
  name: string;
  kind: TimelineKind;
  steps: WorklistStep[];
}

export interface FakeTimelineUser {
  timelineId: number;
  userId: number;
  roleCode: string;
  removed?: boolean;
}

export interface FakeMembership {
  id: number;
  timelineId: number;
  resultCode: number;
  title: string | null;
  programId: number;
  resultTypeKey: string;
  round?: number;
  status?: TimelineResultStatus;
  ended?: boolean;
  endReason?: TimelineResultEndReason | null;
  changedFields?: string[] | null;
  /** `timeline_results.snapshot_sk`; default `SNAP#<code>` (a test of the real key passes the runner's own). */
  snapshotSk?: string;
  /** The phase's result id (default: the result code) and year (default: the cycle's year, 2026). */
  resultId?: number;
  phaseYear?: number;
}

export interface FakeAssessment {
  id: number;
  membershipId: number;
  stepPosition: number;
  status: ResultAssessmentStatus;
  finishedBy?: number | null;
  finishedAt?: Date | null;
  /** The version NUMBER the assessment pinned (`result_assessments.field_config_version`). Default 1. */
  fieldConfigVersion?: number;
  /** The id of that version row, which the membership statement joins in. Default: the number; `null` = no such row. */
  fieldConfigVersionId?: number | null;
  /** Set by the write side when it creates the row. */
  roleCode?: string;
  createdBy?: number;
}

/** One `assessment_audit_events` row, as the write side appended it. */
export type FakeAuditEvent = AuditEventWrite;

export interface FakeComment {
  assessmentId: number;
  authorId: number;
  state: CommentState;
  id?: number;
  fieldKey?: string;
  body?: string;
  createdAt?: Date;
  valueCopy?: { value: unknown; labels?: unknown };
  valueTruncated?: boolean;
  stepPosition?: number;
  round?: number;
  withdrawnAt?: Date | null;
  /** Set by the write side when an end makes the comment visible to the program. */
  visibleToProgramAt?: Date | null;
}

/** One `assessment_releases` row, as the write side queued it. */
export interface FakeRelease extends NewReleaseRow {
  status: 'pending' | 'sent' | 'refused';
}

/**
 * The outbox columns that `NewReleaseRow` does not carry, kept beside the row
 * (by assessment id) so a spec that compares a queued row whole is unchanged.
 */
export interface FakeReleaseMeta {
  id: number;
  attempts: number;
  leaseUntil: Date | null;
  reason: string | null;
  sentAt: Date | null;
}

/** One `quick_comments` row. */
export interface FakeQuickComment {
  id: number;
  roleCode: string;
  body: string;
  bodyHash: string;
  createdBy: number;
  createdAt: Date;
}

/** One `comment_events` row, as the write side appended it. */
export type FakeCommentEvent = CommentEventWrite;

export interface FakeValidation {
  assessmentId: number;
  fieldKey: string;
  validated: boolean;
}

export interface FakeUser {
  id: number;
  nickname: string | null;
}

/** Three steps like the defaults: assessors (1), programs (2), lead assessors (3). */
export function defaultFakeSteps(): WorklistStep[] {
  const step = (
    position: number,
    audience: WorklistStep['audience'],
    opensAt: string,
    closesAt: string,
  ): WorklistStep => ({
    position,
    name: `Step ${position}`,
    audience,
    opensAt: opensAt as RomeMinute,
    closesAt: closesAt as RomeMinute,
  });
  return [
    step(1, 'assessors', '2026-03-01T00:00', '2026-03-31T23:59'),
    step(2, 'programs', '2026-04-01T00:00', '2026-04-30T23:59'),
    step(3, 'lead_assessors', '2026-05-01T00:00', '2026-05-31T23:59'),
  ];
}

export class InMemoryAssessmentWorld {
  /** Statements the services issued since the last `resetStatements()`. */
  statements = 0;
  timelines: FakeTimeline[] = [];
  timelineUsers: FakeTimelineUser[] = [];
  memberships: FakeMembership[] = [];
  assessments: FakeAssessment[] = [];
  comments: FakeComment[] = [];
  validations: FakeValidation[] = [];
  /** The append-only audit rows (FR-21). */
  audits: FakeAuditEvent[] = [];
  /** The append-only `comment_events` rows (ADR-006). */
  commentEvents: FakeCommentEvent[] = [];
  /**
   * How many end UPDATEs matched a row, whatever became of their transaction
   * (it is never undone): with the `status = 'pending'` guard it is the number
   * of ends the database let through, one per assessment (FR-17).
   */
  endUpdatesMatched = 0;
  /** The release rows the ends queued (FR-18). */
  releases: FakeRelease[] = [];
  /** The outbox columns of each release, by assessment id (T-12). */
  releaseMeta = new Map<number, FakeReleaseMeta>();
  nextReleaseId = 500;
  /** Release ids (outbox ids) another dispatcher holds `FOR UPDATE`: `SKIP LOCKED` leaves them out of a claim. */
  lockedReleaseIds = new Set<number>();
  /** The saved quick comments of every role. */
  quickComments: FakeQuickComment[] = [];
  nextQuickCommentId = 9000;
  /** The id the write side gives the next comment it inserts. */
  nextCommentId = 7000;
  /**
   * A deferred interleaving: while set, `lockAssessment` waits until this many
   * transactions reached it, then lets them all read the row together. The fake
   * has no row lock, so every one of them reads `pending`: only the conditional
   * end UPDATE (`endAssessment`) can then decide who ends it, which is the
   * guard a finish race stands on (FR-17).
   */
  holdLockUntil: number | null = null;
  private lockArrivals: Array<() => void> = [];
  /**
   * The version `effectiveFor` answers, one per call, then 1 (a first write
   * that races another sees the configuration as it was at ITS read).
   */
  effectiveVersions: number[] = [];
  /**
   * The `markExecuted` calls of committed and in-flight transactions, as
   * `{ key, targetId }`. When `idempotency` is set the call is also made on it
   * (the e2e store the interceptor reserved the key in).
   */
  marks: Array<{ key: string; targetId: number }> = [];
  /** The idempotency store `markExecuted` goes to, when an app wires one. */
  idempotency: Pick<IdempotencyStore, 'markExecuted'> | null = null;
  /** The id the write side gives the next assessment row it creates. */
  nextAssessmentId = 1000;
  /** Transactions the unit of work ran (committed or rolled back). */
  transactions = 0;
  /**
   * Called inside `lockAssessment`, right before the row is read: a deferred
   * interleaving. A test uses it to let another writer commit between the
   * service's reads and the row lock, the way a second request would. It may
   * be async: the lock waits for it, so a whole second request (a finish) can
   * run to its commit while this transaction is in flight, as it does behind a
   * row lock.
   */
  beforeLockAssessment: (() => void | Promise<void>) | null = null;
  /** Called inside `lockTimelineShared`, before the timeline is read: a timeline edit that commits first. */
  beforeLockTimeline: (() => void) | null = null;
  /** The write-port calls of the transactions, in the order they ran: the lock order of design 5. */
  writeLog: string[] = [];
  users: FakeUser[] = [];
  /** The effective items of `FakeFieldConfigEffective`, by result type. A type with none reads every field Hidden. */
  fieldConfigItems: Record<string, EffectiveFieldConfig['items']> = {};
  /** The items of a PINNED version, by version id then result type: what `versionItems` reads. Nothing falls back to `fieldConfigItems`. */
  versionItems: Record<number, Record<string, ConfigItem[]>> = {};
  /** Set to make `effectiveFor` throw `FieldConfigNoVersionError`. */
  noFieldConfigVersion = false;
  /** Set to make `effectiveFor` throw `TimelineNotFoundError` (the timeline vanished between two reads). */
  effectiveTimelineGone = false;

  /** The outbox columns of a release row, created on first use. */
  metaOf(release: FakeRelease): FakeReleaseMeta {
    let meta = this.releaseMeta.get(release.assessmentId);
    if (meta === undefined) {
      meta = {
        id: this.nextReleaseId++,
        attempts: 0,
        leaseUntil: null,
        reason: null,
        sentAt: null,
      };
      this.releaseMeta.set(release.assessmentId, meta);
    }
    return meta;
  }

  resetStatements(): void {
    this.statements = 0;
  }

  /** Called by `lockAssessment`: waits for `holdLockUntil` arrivals when it is set. */
  async arriveAtLock(): Promise<void> {
    if (this.holdLockUntil === null) return;
    await new Promise<void>((resolve) => {
      this.lockArrivals.push(resolve);
      if (this.lockArrivals.length >= (this.holdLockUntil ?? 0)) {
        const waiting = this.lockArrivals;
        this.lockArrivals = [];
        // Released once: a later lock in the same test (a retry, a follow-up request) must not wait for arrivals that never come.
        this.holdLockUntil = null;
        for (const release of waiting) release();
      }
    });
  }
}

function compare(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const left = String(a).toLowerCase();
  const right = String(b).toLowerCase();
  return left < right ? -1 : left > right ? 1 : 0;
}

export class InMemoryWorklistStore implements WorklistStore {
  constructor(private readonly world: InMemoryAssessmentWorld) {}

  findTimelines(
    userId: number,
    timelineId?: number,
  ): Promise<WorklistTimeline[]> {
    this.world.statements += 1;
    return Promise.resolve(
      this.world.timelines
        .filter((t) => (t.cycleStatus ?? 'active') === 'active')
        .filter((t) => timelineId === undefined || t.id === timelineId)
        .map((t) => ({
          id: t.id,
          cycleId: t.cycleId ?? 1,
          name: t.name,
          kind: t.kind,
          steps: [...t.steps].sort((a, b) => a.position - b.position),
          roleCodes: this.world.timelineUsers
            .filter(
              (row) =>
                row.timelineId === t.id &&
                row.userId === userId &&
                row.removed !== true,
            )
            .map((row) => row.roleCode),
        })),
    );
  }

  findPage(criteria: WorklistPageCriteria): Promise<WorklistRecord[]> {
    this.world.statements += 1;
    const { sort, filters } = criteria;
    const q = filters.q?.toLowerCase() ?? null;
    const records = this.listed(criteria)
      .filter((r) => {
        if (filters.statuses.length > 0) {
          if (r.status === null || !filters.statuses.includes(r.status)) {
            return false;
          }
        }
        if (
          filters.programIds.length > 0 &&
          !filters.programIds.includes(r.programId)
        ) {
          return false;
        }
        if (
          filters.resultTypeKeys.length > 0 &&
          !filters.resultTypeKeys.includes(r.resultTypeKey)
        ) {
          return false;
        }
        if (q !== null) {
          const byCode = String(r.resultCode).startsWith(q);
          const byTitle = (r.title ?? '').toLowerCase().includes(q);
          if (!byCode && !byTitle) return false;
        }
        return true;
      })
      .map((r) => ({
        ...r,
        sortValue: this.sortValue(r, criteria),
      }));
    const sign = sort.dir === 'asc' ? 1 : -1;
    records.sort(
      (a, b) =>
        sign * compare(a.sortValue, b.sortValue) ||
        a.resultCode - b.resultCode ||
        a.membershipId - b.membershipId,
    );
    const after = criteria.after;
    const kept =
      after === null
        ? records
        : records.filter((r) => {
            const c = sign * compare(r.sortValue, after.value);
            return (
              c > 0 ||
              (c === 0 &&
                (r.resultCode > after.resultCode ||
                  (r.resultCode === after.resultCode &&
                    r.membershipId > after.membershipId)))
            );
          });
    return Promise.resolve(kept.slice(0, criteria.take));
  }

  countByStatus(scope: WorklistScope): Promise<WorklistStatusCount[]> {
    this.world.statements += 1;
    const groups = new Map<QaStatus | null, number>();
    for (const r of this.listed(scope)) {
      groups.set(r.status, (groups.get(r.status) ?? 0) + 1);
    }
    return Promise.resolve(
      [...groups].map(([status, count]) => ({ status, count })),
    );
  }

  /** Memberships the scope lists (T-3 predicate), joined and with the auto-validated hiding. */
  private listed(
    scope: WorklistScope,
  ): Array<Omit<WorklistRecord, 'sortValue'>> {
    const timing = {
      steps: [
        {
          position: 2,
          audience: 'programs' as const,
          opensAt: '2000-01-01T00:00' as RomeMinute,
          closesAt: (scope.clarificationWindowOpen
            ? '2999-01-01T00:00'
            : '2000-01-02T00:00') as RomeMinute,
        },
      ],
      now: '2026-01-01T00:00' as RomeMinute,
      hasLoad: true,
    };
    const out: Array<Omit<WorklistRecord, 'sortValue'>> = [];
    for (const m of this.world.memberships) {
      if (m.timelineId !== scope.timelineId) continue;
      const assessment = this.world.assessments.find(
        (a) =>
          a.membershipId === m.id &&
          scope.assessmentStepPosition !== null &&
          a.stepPosition === scope.assessmentStepPosition,
      );
      const anyAssessmentIds = this.world.assessments
        .filter((a) => a.membershipId === m.id)
        .map((a) => a.id);
      const facts: MembershipFacts = {
        resultType: m.resultTypeKey,
        programId: m.programId,
        round: m.round ?? 1,
        status: m.status ?? 'pending',
        ended: m.ended ?? false,
        endReason: m.endReason ?? null,
      };
      const authoredClarification = this.world.comments.some(
        (c) =>
          anyAssessmentIds.includes(c.assessmentId) &&
          c.authorId === scope.userId &&
          c.state === 'clarification_requested',
      );
      if (!listedFor(scope.access, facts, { timing, authoredClarification })) {
        continue;
      }
      const status = statusOf({
        membershipStatus: facts.status,
        endReason: facts.endReason,
        assessmentStatus: assessment?.status ?? null,
        hasClarificationThread:
          assessment !== undefined &&
          this.world.comments.some(
            (c) =>
              c.assessmentId === assessment.id &&
              c.state === 'clarification_requested',
          ),
      });
      if (scope.hideAutoValidated && status === 'auto_validated') continue;
      const finisher =
        assessment?.finishedBy === undefined || assessment.finishedBy === null
          ? undefined
          : this.world.users.find((u) => u.id === assessment.finishedBy);
      out.push({
        membershipId: m.id,
        resultCode: m.resultCode,
        title: m.title,
        updated: facts.round === 2 && (m.changedFields?.length ?? 0) > 0,
        programId: m.programId,
        resultTypeKey: m.resultTypeKey,
        round: facts.round,
        membershipStatus: facts.status,
        ended: facts.ended,
        endReason: facts.endReason,
        comments:
          assessment === undefined
            ? 0
            : this.world.comments.filter(
                (c) =>
                  c.assessmentId === assessment.id && c.state !== 'withdrawn',
              ).length,
        assessedById: finisher?.id ?? null,
        assessedByNickname: finisher?.nickname ?? null,
        status,
      });
    }
    return out;
  }

  private sortValue(
    r: Omit<WorklistRecord, 'sortValue'>,
    criteria: WorklistPageCriteria,
  ): string | number {
    switch (criteria.sort.key) {
      case 'code':
        return r.resultCode;
      case 'title':
        return r.title ?? '';
      case 'program':
        return criteria.sort.programOrder.indexOf(r.programId) + 1;
      case 'resultType':
        return criteria.sort.resultTypeOrder.indexOf(r.resultTypeKey) + 1;
      case 'comments':
        return r.comments;
      case 'answered':
        return 0;
      case 'assessedBy':
        return r.assessedByNickname ?? '';
      case 'status':
        return r.status ?? '';
    }
  }
}

/**
 * "Has a load" = the timeline holds a membership; one statement per call, like the adapter.
 * Unlike the production `DrizzleTimelineLoads`, it does not also count a running load
 * with a live lease. That only moves a step's state and `writable`, never the scope.
 */
export class InMemoryTimelineLoads implements TimelineLoads {
  constructor(private readonly world: InMemoryAssessmentWorld) {}

  withLoad(timelineIds: readonly number[]): Promise<ReadonlySet<number>> {
    if (timelineIds.length === 0) return Promise.resolve(new Set<number>());
    this.world.statements += 1;
    return Promise.resolve(
      new Set(
        this.world.memberships
          .map((m) => m.timelineId)
          .filter((id) => timelineIds.includes(id)),
      ),
    );
  }
}

/**
 * The assessment read port over the same world, with the semantics of the
 * Drizzle adapter: the scope is the T-3 predicate `inScope` (the SQL twin is
 * `scopeCondition`), the membership is the latest round inside it, and each
 * call is one counted statement.
 */
export class InMemoryAssessmentStore implements AssessmentStore {
  constructor(private readonly world: InMemoryAssessmentWorld) {}

  findMembership(
    criteria: MembershipCriteria,
  ): Promise<MembershipRecord | null> {
    this.world.statements += 1;
    const timeline = this.world.timelines.find(
      (t) => t.id === criteria.timelineId,
    );
    const found = this.world.memberships
      .filter(
        (m) =>
          m.timelineId === criteria.timelineId &&
          m.resultCode === criteria.resultCode,
      )
      .filter((m) => {
        const facts: MembershipFacts = {
          resultType: m.resultTypeKey,
          programId: m.programId,
          round: m.round ?? 1,
          status: m.status ?? 'pending',
          ended: m.ended ?? false,
          endReason: m.endReason ?? null,
        };
        return (
          inScope(criteria.access, facts) &&
          (!criteria.access.admin ||
            criteria.round === null ||
            facts.round === criteria.round)
        );
      })
      .sort((x, y) => (y.round ?? 1) - (x.round ?? 1))[0];
    if (found === undefined) return Promise.resolve(null);
    const assessment = this.world.assessments.find(
      (a) =>
        a.membershipId === found.id &&
        criteria.assessmentStepPosition !== null &&
        a.stepPosition === criteria.assessmentStepPosition,
    );
    const finisher =
      assessment?.finishedBy === undefined || assessment.finishedBy === null
        ? undefined
        : this.world.users.find((u) => u.id === assessment.finishedBy);
    return Promise.resolve({
      membershipId: found.id,
      resultCode: found.resultCode,
      resultId: found.resultId ?? found.resultCode,
      phaseYear: found.phaseYear ?? timeline?.cycleYear ?? 2026,
      title: found.title,
      programId: found.programId,
      resultTypeKey: found.resultTypeKey,
      round: found.round ?? 1,
      status: found.status ?? 'pending',
      ended: found.ended ?? false,
      endReason: found.endReason ?? null,
      snapshotSk: found.snapshotSk ?? `SNAP#${found.resultCode}`,
      cycleYear: timeline?.cycleYear ?? 2026,
      assessment:
        assessment === undefined
          ? null
          : {
              id: assessment.id,
              status: assessment.status,
              fieldConfigVersion: assessment.fieldConfigVersion ?? 1,
              fieldConfigVersionId:
                assessment.fieldConfigVersionId === undefined
                  ? (assessment.fieldConfigVersion ?? 1)
                  : assessment.fieldConfigVersionId,
              finishedAt: assessment.finishedAt ?? null,
              finishedById: finisher?.id ?? null,
              finishedByNickname: finisher?.nickname ?? null,
            },
    });
  }

  findValidations(assessmentId: number): Promise<ValidationRecord[]> {
    this.world.statements += 1;
    return Promise.resolve(
      this.world.validations
        .filter((v) => v.assessmentId === assessmentId)
        .map(({ fieldKey, validated }) => ({ fieldKey, validated })),
    );
  }

  findComments(assessmentId: number): Promise<CommentRecord[]> {
    this.world.statements += 1;
    return Promise.resolve(
      this.world.comments
        .map((c, index) => ({ c, index }))
        .filter(({ c }) => c.assessmentId === assessmentId)
        .map(({ c, index }) => commentRecordOf(this.world, c, index)),
    );
  }

  listQuickComments(roleCode: string): Promise<QuickCommentRecord[]> {
    this.world.statements += 1;
    return Promise.resolve(
      this.world.quickComments
        .filter((q) => q.roleCode === roleCode)
        .sort(
          (x, y) =>
            y.createdAt.getTime() - x.createdAt.getTime() || y.id - x.id,
        )
        .map(({ id, body, createdAt }) => ({ id, body, createdAt })),
    );
  }

  findCommentContext(commentId: number): Promise<CommentContext | null> {
    this.world.statements += 1;
    const index = this.world.comments.findIndex(
      (c, i) => (c.id ?? i + 1) === commentId,
    );
    const comment = this.world.comments[index];
    if (comment === undefined) return Promise.resolve(null);
    const assessment = this.world.assessments.find(
      (a) => a.id === comment.assessmentId,
    );
    const membership = this.world.memberships.find(
      (m) => m.id === assessment?.membershipId,
    );
    if (assessment === undefined || membership === undefined) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      ...commentRecordOf(this.world, comment, index),
      assessmentId: assessment.id,
      timelineResultId: membership.id,
      timelineId: membership.timelineId,
      resultCode: membership.resultCode,
    });
  }
}

/** A stored fake comment as the read port returns it (the join with the author's nickname). */
function commentRecordOf(
  world: InMemoryAssessmentWorld,
  c: FakeComment,
  index: number,
): CommentRecord {
  const createdAt = c.createdAt ?? new Date('2026-03-10T09:00:00.000Z');
  return {
    id: c.id ?? index + 1,
    fieldKey: c.fieldKey ?? 'general.title',
    authorId: c.authorId,
    authorNickname:
      world.users.find((u) => u.id === c.authorId)?.nickname ?? null,
    body: c.body ?? 'A comment',
    state: c.state,
    stepPosition: c.stepPosition ?? 1,
    round: c.round ?? 1,
    valueCopy: c.valueCopy ?? { value: null },
    valueTruncated: c.valueTruncated ?? false,
    createdAt,
    withdrawnAt: c.state === 'withdrawn' ? (c.withdrawnAt ?? createdAt) : null,
  };
}

/**
 * `FieldConfigEffective` over the world, counting what production runs.
 * `effectiveFor` is FIVE statements: `listTimelineStarts` is three (the
 * timelines, their steps, their scope rows), then `listVersions` and
 * `listVersionItems`. `versionItems` is ONE (`listVersionItems`). The e2e
 * statement budget (NFR-2) is therefore the real one.
 */
export class FakeFieldConfigEffective implements FieldConfigEffective {
  constructor(private readonly world: InMemoryAssessmentWorld) {}

  effectiveFor(
    _cycleId: number,
    timelineId: number,
    resultTypeKey: string,
  ): Promise<EffectiveFieldConfig> {
    this.world.statements += 5;
    if (this.world.effectiveTimelineGone) {
      return Promise.reject(new TimelineNotFoundError(timelineId));
    }
    if (this.world.noFieldConfigVersion) {
      return Promise.reject(new FieldConfigNoVersionError(timelineId));
    }
    return Promise.resolve({
      timelineId,
      resultTypeKey,
      version: this.world.effectiveVersions.shift() ?? 1,
      provisional: false,
      items: this.world.fieldConfigItems[resultTypeKey] ?? [],
    });
  }

  versionItems(
    versionId: number,
    resultTypeKey: string,
  ): Promise<ConfigItem[]> {
    this.world.statements += 1;
    return Promise.resolve(
      this.world.versionItems[versionId]?.[resultTypeKey] ?? [],
    );
  }
}

/**
 * The write port over the world, with the semantics of the Drizzle adapter:
 * `ensureAssessment` keeps an existing row (the duplicate-key no-op),
 * `lockAssessment` reads the row as it is at the moment of the lock, and each
 * call is as many counted statements as the adapter runs.
 *
 * Limitation: the fake holds no row locks, and `ensureAssessment` does not WAIT
 * on a duplicate insert. In MySQL a second first writer blocks on the first
 * one's uncommitted row until it commits or rolls back, so a writer that found
 * the duplicate never relies on a row that then vanishes. Here the first
 * inserter's row is visible at once and its undo log removes it on a rollback,
 * so a second first writer that took the duplicate no-op would lose the row
 * under it (MySQL cannot do that). Tests that need the winner's row seed it,
 * or race writers on an existing row.
 */
export class InMemoryAssessmentWriteStore implements AssessmentWriteStore {
  /**
   * `undo` is the transaction's own undo log: every mutation pushes its inverse,
   * and a rollback runs it backwards. A rollback therefore undoes ONLY what its
   * transaction wrote, never another transaction's commit in between.
   */
  constructor(
    private readonly world: InMemoryAssessmentWorld,
    private readonly undo: Array<() => void> = [],
  ) {}

  lockTimelineShared(timelineId: number): Promise<WorklistStep[] | null> {
    this.world.statements += 2;
    this.world.writeLog.push('lockTimelineShared');
    this.world.beforeLockTimeline?.();
    const timeline = this.world.timelines.find((t) => t.id === timelineId);
    return Promise.resolve(
      timeline === undefined
        ? null
        : [...timeline.steps].sort((a, b) => a.position - b.position),
    );
  }

  ensureAssessment(row: NewAssessmentRow): Promise<void> {
    this.world.statements += 1;
    this.world.writeLog.push('ensureAssessment');
    const exists = this.world.assessments.some(
      (a) =>
        a.membershipId === row.timelineResultId &&
        a.stepPosition === row.stepPosition,
    );
    if (!exists) {
      const created: FakeAssessment = {
        id: this.world.nextAssessmentId++,
        membershipId: row.timelineResultId,
        stepPosition: row.stepPosition,
        status: 'pending',
        fieldConfigVersion: row.fieldConfigVersion,
        roleCode: row.roleCode,
        createdBy: row.createdBy,
      };
      this.world.assessments.push(created);
      this.undo.push(() => {
        this.world.assessments = this.world.assessments.filter(
          (a) => a !== created,
        );
      });
    }
    return Promise.resolve();
  }

  async lockAssessment(
    timelineResultId: number,
    stepPosition: number,
  ): Promise<LockedAssessment | undefined> {
    this.world.statements += 1;
    this.world.writeLog.push('lockAssessment');
    await this.world.beforeLockAssessment?.();
    await this.world.arriveAtLock();
    const row = this.world.assessments.find(
      (a) =>
        a.membershipId === timelineResultId && a.stepPosition === stepPosition,
    );
    return row === undefined
      ? undefined
      : {
          id: row.id,
          status: row.status,
          fieldConfigVersion: row.fieldConfigVersion ?? 1,
          membershipEnded:
            this.world.memberships.find((m) => m.id === timelineResultId)
              ?.ended ?? false,
        };
  }

  findValidations(assessmentId: number): Promise<ValidationRecord[]> {
    this.world.statements += 1;
    this.world.writeLog.push('findValidations');
    return Promise.resolve(
      this.world.validations
        .filter((v) => v.assessmentId === assessmentId)
        .map(({ fieldKey, validated }) => ({ fieldKey, validated })),
    );
  }

  upsertValidations(
    assessmentId: number,
    rows: readonly ValidationWrite[],
  ): Promise<void> {
    if (rows.length === 0) return Promise.resolve();
    this.world.statements += 1;
    this.world.writeLog.push('upsertValidations');
    for (const row of rows) {
      const held = this.world.validations.find(
        (v) => v.assessmentId === assessmentId && v.fieldKey === row.fieldKey,
      );
      if (held === undefined) {
        const created = { assessmentId, ...row };
        this.world.validations.push(created);
        this.undo.push(() => {
          this.world.validations = this.world.validations.filter(
            (v) => v !== created,
          );
        });
      } else {
        const before = held.validated;
        held.validated = row.validated;
        this.undo.push(() => {
          held.validated = before;
        });
      }
    }
    return Promise.resolve();
  }

  insertAudit(event: AuditEventWrite): Promise<void> {
    this.world.statements += 1;
    this.world.writeLog.push('insertAudit');
    const row = { ...event };
    this.world.audits.push(row);
    this.undo.push(() => {
      this.world.audits = this.world.audits.filter((a) => a !== row);
    });
    return Promise.resolve();
  }

  insertComment(row: NewCommentRow): Promise<number> {
    this.world.statements += 1;
    this.world.writeLog.push('insertComment');
    const id = this.world.nextCommentId++;
    const created: FakeComment = {
      id,
      assessmentId: row.assessmentId,
      authorId: row.authorId,
      state: 'open',
      fieldKey: row.fieldKey,
      body: row.body,
      createdAt: row.at,
      valueCopy: row.valueCopy,
      valueTruncated: row.valueTruncated,
      stepPosition: row.stepPosition,
      round: row.round,
    };
    this.world.comments.push(created);
    this.undo.push(() => {
      this.world.comments = this.world.comments.filter((c) => c !== created);
    });
    return Promise.resolve(id);
  }

  withdrawComment(commentId: number, at: Date): Promise<boolean> {
    this.world.statements += 1;
    this.world.writeLog.push('withdrawComment');
    const held = this.world.comments.find(
      (c, i) => (c.id ?? i + 1) === commentId,
    );
    // The conditional UPDATE: it matches the row only while it is `open`.
    if (held === undefined || held.state !== 'open') {
      return Promise.resolve(false);
    }
    held.state = 'withdrawn';
    held.withdrawnAt = at;
    this.undo.push(() => {
      held.state = 'open';
      held.withdrawnAt = null;
    });
    return Promise.resolve(true);
  }

  insertCommentEvent(event: CommentEventWrite): Promise<void> {
    this.world.statements += 1;
    this.world.writeLog.push('insertCommentEvent');
    const row = { ...event };
    this.world.commentEvents.push(row);
    this.undo.push(() => {
      this.world.commentEvents = this.world.commentEvents.filter(
        (e) => e !== row,
      );
    });
    return Promise.resolve();
  }

  endAssessment(end: AssessmentEndWrite): Promise<boolean> {
    this.world.statements += 1;
    this.world.writeLog.push('endAssessment');
    const held = this.world.assessments.find((a) => a.id === end.assessmentId);
    // The conditional UPDATE: it matches the row only while it is `pending`.
    if (held === undefined || held.status !== 'pending') {
      return Promise.resolve(false);
    }
    this.world.endUpdatesMatched += 1;
    held.status = end.status;
    held.finishedBy = end.actorId;
    held.finishedAt = end.at;
    this.undo.push(() => {
      held.status = 'pending';
      held.finishedBy = null;
      held.finishedAt = null;
    });
    return Promise.resolve(true);
  }

  findCommentedFieldKeys(assessmentId: number): Promise<string[]> {
    this.world.statements += 1;
    this.world.writeLog.push('findCommentedFieldKeys');
    return Promise.resolve([
      ...new Set(
        this.world.comments
          .filter(
            (c) => c.assessmentId === assessmentId && c.state !== 'withdrawn',
          )
          .map((c) => c.fieldKey ?? 'general.title'),
      ),
    ]);
  }

  markCommentsVisible(assessmentId: number, at: Date): Promise<void> {
    this.world.statements += 1;
    this.world.writeLog.push('markCommentsVisible');
    for (const comment of this.world.comments) {
      if (
        comment.assessmentId !== assessmentId ||
        comment.state === 'withdrawn' ||
        (comment.visibleToProgramAt ?? null) !== null
      ) {
        continue;
      }
      comment.visibleToProgramAt = at;
      this.undo.push(() => {
        comment.visibleToProgramAt = null;
      });
    }
    return Promise.resolve();
  }

  insertRelease(row: NewReleaseRow): Promise<void> {
    this.world.statements += 1;
    this.world.writeLog.push('insertRelease');
    // The unique key `uq_assessment_releases_assessment`: one release per end.
    if (this.world.releases.some((r) => r.assessmentId === row.assessmentId)) {
      return Promise.reject(
        Object.assign(new Error('Duplicate entry'), {
          code: 'ER_DUP_ENTRY',
          errno: 1062,
        }),
      );
    }
    const created: FakeRelease = { ...row, status: 'pending' };
    this.world.releases.push(created);
    this.undo.push(() => {
      this.world.releases = this.world.releases.filter((r) => r !== created);
    });
    return Promise.resolve();
  }

  saveQuickComment(row: NewQuickCommentRow): Promise<SavedQuickComment> {
    this.world.statements += 1;
    this.world.writeLog.push('saveQuickComment');
    const existing = this.world.quickComments.find(
      (q) => q.roleCode === row.roleCode && q.bodyHash === row.bodyHash,
    );
    if (existing !== undefined) {
      this.world.statements += 1;
      return Promise.resolve({
        id: existing.id,
        body: existing.body,
        createdAt: existing.createdAt,
        created: false,
      });
    }
    const created: FakeQuickComment = {
      id: this.world.nextQuickCommentId++,
      roleCode: row.roleCode,
      body: row.body,
      bodyHash: row.bodyHash,
      createdBy: row.createdBy,
      createdAt: row.at,
    };
    this.world.quickComments.push(created);
    this.undo.push(() => {
      this.world.quickComments = this.world.quickComments.filter(
        (q) => q !== created,
      );
    });
    return Promise.resolve({
      id: created.id,
      body: created.body,
      createdAt: created.createdAt,
      created: true,
    });
  }
}

/**
 * The outbox on the pool (T-12). The claim is atomic, as the real one is (the
 * due ids are read `FOR UPDATE SKIP LOCKED` and leased in one transaction): a
 * row leased by one dispatcher is not due for the next until the lease passes.
 */
export class InMemoryReleaseStore implements ReleaseStore {
  constructor(private readonly world: InMemoryAssessmentWorld) {}

  claimDue(
    clock: () => Date,
    leaseMs: number,
    limit: number,
  ): Promise<DueRelease[]> {
    this.world.writeLog.push('claimDue');
    const now = clock();
    const leaseUntil = new Date(now.getTime() + leaseMs);
    const dueRows = this.world.releases
      .filter((release) => {
        const meta = this.world.metaOf(release);
        return (
          release.status === 'pending' &&
          (meta.leaseUntil === null || meta.leaseUntil < now)
        );
      })
      .sort((a, b) => this.world.metaOf(a).id - this.world.metaOf(b).id);
    // The due years, the one with the oldest due row first (the real read takes no lock).
    const years = [...new Set(dueRows.map((r) => r.phaseYear))].slice(0, 10);
    // ONE claim is ONE send batch: the first year with a row it can lock; `SKIP LOCKED` leaves the held rows out, then `LIMIT`, and only then the result-id dedupe, as the real claim does.
    let due: FakeRelease[] = [];
    for (const year of years) {
      const read = dueRows
        .filter(
          (r) =>
            r.phaseYear === year &&
            !this.world.lockedReleaseIds.has(this.world.metaOf(r).id),
        )
        .slice(0, limit);
      const seen = new Set<number>();
      due = read.filter((r) => !seen.has(r.resultId) && seen.add(r.resultId));
      if (due.length > 0) break;
    }
    return Promise.resolve(
      due.map((release) => {
        const meta = this.world.metaOf(release);
        meta.leaseUntil = leaseUntil;
        // A tinyint: the real claim stops at 255.
        meta.attempts = Math.min(meta.attempts + 1, 255);
        const membership = this.world.memberships.find(
          (m) => m.id === release.timelineResultId,
        );
        return {
          id: meta.id,
          assessmentId: release.assessmentId,
          timelineId: membership?.timelineId ?? 0,
          timelineResultId: release.timelineResultId,
          resultId: release.resultId,
          phaseYear: release.phaseYear,
          outcome: release.outcome,
          attempts: meta.attempts,
          leaseUntil,
        };
      }),
    );
  }

  list(status: ReleaseListStatus): Promise<ReleaseListItem[]> {
    return Promise.resolve(
      this.world.releases
        .filter((release) => release.status === status)
        .map((release) => {
          const meta = this.world.metaOf(release);
          const membership = this.world.memberships.find(
            (m) => m.id === release.timelineResultId,
          );
          const timeline = this.world.timelines.find(
            (t) => t.id === membership?.timelineId,
          );
          return {
            id: meta.id,
            timeline: { id: timeline?.id ?? 0, name: timeline?.name ?? '' },
            resultCode: membership?.resultCode ?? 0,
            outcome: release.outcome,
            status: release.status,
            attempts: meta.attempts,
            reason: meta.reason,
            createdAt: release.at,
          };
        })
        .sort((a, b) => a.id - b.id),
    );
  }
}

/** The release statements of one ack transaction, with the undo log of its unit of work. */
export class InMemoryReleaseWriteStore implements ReleaseWriteStore {
  constructor(
    private readonly world: InMemoryAssessmentWorld,
    private readonly undo: Array<() => void>,
  ) {}

  lockAssessment(
    assessmentId: number,
  ): Promise<LockedReleaseAssessment | undefined> {
    this.world.writeLog.push('lockReleaseAssessment');
    const row = this.world.assessments.find((a) => a.id === assessmentId);
    return Promise.resolve(
      row === undefined
        ? undefined
        : { id: row.id, finishedBy: row.finishedBy ?? null },
    );
  }

  settle(settle: ReleaseSettle): Promise<boolean> {
    this.world.writeLog.push('settleRelease');
    const release = this.world.releases.find(
      (r) => this.world.metaOf(r).id === settle.id,
    );
    // The conditional UPDATE: it matches the row only while it is `pending`.
    if (release === undefined || release.status !== 'pending') {
      return Promise.resolve(false);
    }
    const meta = this.world.metaOf(release);
    release.status = settle.status;
    meta.reason = settle.reason;
    meta.sentAt = settle.status === 'sent' ? settle.at : null;
    this.undo.push(() => {
      release.status = 'pending';
      meta.reason = null;
      meta.sentAt = null;
    });
    return Promise.resolve(true);
  }
}

/** The membership ends of an ack, over the world's memberships, with the same conditions as the Drizzle store. */
export class InMemoryMembershipEnds {
  constructor(
    private readonly world: InMemoryAssessmentWorld,
    private readonly undo: Array<() => void>,
  ) {}

  endAsReleasedQaed(id: number, at: Date): Promise<EndAsReleasedQaedOutcome> {
    this.world.writeLog.push('endAsReleasedQaed');
    return Promise.resolve(this.end(id, at, 'released_qaed', false));
  }

  endAsReturned(id: number, at: Date): Promise<EndAsReturnedOutcome> {
    this.world.writeLog.push('endAsReturned');
    return Promise.resolve(this.end(id, at, 'returned', true));
  }

  private end(
    id: number,
    _at: Date,
    reason: TimelineResultEndReason,
    roundOneOnly: boolean,
  ): EndAsReleasedQaedOutcome | EndAsReturnedOutcome {
    const membership = this.world.memberships.find((m) => m.id === id);
    if (membership === undefined) return { ended: false, reason: 'not_found' };
    if (membership.ended === true) {
      return { ended: false, reason: 'already_ended' };
    }
    if (roundOneOnly && (membership.round ?? 1) !== 1) {
      return { ended: false, reason: 'not_round_1' };
    }
    membership.ended = true;
    membership.endReason = reason;
    this.undo.push(() => {
      membership.ended = false;
      membership.endReason = null;
    });
    return { ended: true };
  }
}

/**
 * One transaction over the world: what `work` wrote is kept when it resolves
 * and put back when it throws. The rollback is the transaction's own undo log
 * (see `InMemoryAssessmentWriteStore`), so it never reverts a write another
 * transaction committed while this one was open. The old whole-world restore
 * did exactly that to a concurrent writer.
 */
export class InMemoryAssessmentUnitOfWork implements AssessmentUnitOfWork {
  constructor(private readonly world: InMemoryAssessmentWorld) {}

  async run<T>(
    work: (repositories: AssessmentRepositories) => Promise<T>,
  ): Promise<T> {
    this.world.transactions += 1;
    const undo: Array<() => void> = [];
    try {
      return await work({
        assessments: new InMemoryAssessmentWriteStore(this.world, undo),
        releases: new InMemoryReleaseWriteStore(this.world, undo),
        loads: new InMemoryMembershipEnds(this.world, undo),
        idempotency: {
          markExecuted: async (reservation: Reservation, targetId: number) => {
            this.world.statements += 1;
            this.world.writeLog.push('markExecuted');
            const entry = { key: reservation.key, targetId };
            this.world.marks.push(entry);
            undo.push(() => {
              this.world.marks = this.world.marks.filter((m) => m !== entry);
            });
            await this.world.idempotency?.markExecuted(reservation, targetId);
          },
        },
      });
    } catch (error) {
      for (const revert of undo.reverse()) revert();
      throw error;
    }
  }
}

/** A dispatcher that does nothing: the services of the specs that are not about the release. */
export const noReleaseDispatch: ReleaseDispatcher = {
  dispatch: () =>
    Promise.resolve({ attempted: 0, sent: 0, refused: 0, stillPending: 0 }),
};
