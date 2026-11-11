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
import { listedFor, type MembershipFacts } from '../../src/assessment/scope.js';
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
}

export interface FakeAssessment {
  id: number;
  membershipId: number;
  stepPosition: number;
  status: ResultAssessmentStatus;
  finishedBy?: number | null;
}

export interface FakeComment {
  assessmentId: number;
  authorId: number;
  state: CommentState;
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
  users: FakeUser[] = [];

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
