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
  AssessmentStore,
  AssessmentWriteStore,
  AuditEventWrite,
  CommentRecord,
  LockedAssessment,
  MembershipCriteria,
  MembershipRecord,
  NewAssessmentRow,
  ValidationRecord,
  ValidationWrite,
} from '../../src/assessment/assessment.store.js';
import type {
  AssessmentRepositories,
  AssessmentUnitOfWork,
} from '../../src/assessment/assessment.unit-of-work.js';

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
}

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
  /** The id the write side gives the next assessment row it creates. */
  nextAssessmentId = 1000;
  /** Transactions the unit of work ran (committed or rolled back). */
  transactions = 0;
  /**
   * Called inside `lockAssessment`, right before the row is read: a deferred
   * interleaving. A test uses it to let another writer commit between the
   * service's reads and the row lock, the way a second request would.
   */
  beforeLockAssessment: (() => void) | null = null;
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

  resetStatements(): void {
    this.statements = 0;
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
        .map(({ c, index }) => ({
          id: c.id ?? index + 1,
          fieldKey: c.fieldKey ?? 'general.title',
          authorId: c.authorId,
          authorNickname:
            this.world.users.find((u) => u.id === c.authorId)?.nickname ?? null,
          body: c.body ?? 'A comment',
          state: c.state,
          stepPosition: 1,
          round: 1,
          valueCopy: c.valueCopy ?? { value: null },
          valueTruncated: false,
          createdAt: c.createdAt ?? new Date('2026-03-10T09:00:00.000Z'),
          withdrawnAt:
            c.state === 'withdrawn'
              ? (c.createdAt ?? new Date('2026-03-10T09:00:00.000Z'))
              : null,
        })),
    );
  }
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
      version: 1,
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
 */
export class InMemoryAssessmentWriteStore implements AssessmentWriteStore {
  constructor(private readonly world: InMemoryAssessmentWorld) {}

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
      this.world.assessments.push({
        id: this.world.nextAssessmentId++,
        membershipId: row.timelineResultId,
        stepPosition: row.stepPosition,
        status: 'pending',
        fieldConfigVersion: row.fieldConfigVersion,
        roleCode: row.roleCode,
        createdBy: row.createdBy,
      });
    }
    return Promise.resolve();
  }

  lockAssessment(
    timelineResultId: number,
    stepPosition: number,
  ): Promise<LockedAssessment | undefined> {
    this.world.statements += 1;
    this.world.writeLog.push('lockAssessment');
    this.world.beforeLockAssessment?.();
    const row = this.world.assessments.find(
      (a) =>
        a.membershipId === timelineResultId && a.stepPosition === stepPosition,
    );
    return Promise.resolve(
      row === undefined
        ? undefined
        : {
            id: row.id,
            status: row.status,
            fieldConfigVersion: row.fieldConfigVersion ?? 1,
          },
    );
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
        this.world.validations.push({ assessmentId, ...row });
      } else {
        held.validated = row.validated;
      }
    }
    return Promise.resolve();
  }

  insertAudit(event: AuditEventWrite): Promise<void> {
    this.world.statements += 1;
    this.world.writeLog.push('insertAudit');
    this.world.audits.push({ ...event });
    return Promise.resolve();
  }
}

/**
 * One transaction over the world: what `work` wrote is kept when it resolves
 * and put back as it was when it throws (the rollback). The rows are copied
 * per row, so a write through the fake never leaks into the saved copy.
 */
export class InMemoryAssessmentUnitOfWork implements AssessmentUnitOfWork {
  constructor(private readonly world: InMemoryAssessmentWorld) {}

  async run<T>(
    work: (repositories: AssessmentRepositories) => Promise<T>,
  ): Promise<T> {
    this.world.transactions += 1;
    const saved = {
      assessments: this.world.assessments.map((a) => ({ ...a })),
      validations: this.world.validations.map((v) => ({ ...v })),
      audits: this.world.audits.map((a) => ({ ...a })),
    };
    try {
      return await work({
        assessments: new InMemoryAssessmentWriteStore(this.world),
      });
    } catch (error) {
      this.world.assessments = saved.assessments;
      this.world.validations = saved.validations;
      this.world.audits = saved.audits;
      throw error;
    }
  }
}
