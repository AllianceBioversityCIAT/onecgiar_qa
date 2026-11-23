// P2-3911: the reads of the Science Program view. Scope: a non-admin session
// sees only its own program; an admin session names one (`programId`). Anything
// outside the scope is the same 404 `SP_NOT_FOUND` as anything missing. Comments
// are visible to the program only once the programs step has started, never
// withdrawn ones, and never with the assessor's identity.
import { pickDefaultTimeline } from '../default-timeline.js';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  ADMIN_CONFIG_CLOCK,
  type AdminConfigClock,
} from '../../admin-config/admin-config.clock.js';
import { nowInRome, type RomeMinute } from '../../admin-config/rome-date.js';
import type { TimelineStepState } from '../../admin-config/timelines/timeline-view.js';
import {
  TIMELINE_LOADS,
  type TimelineLoads,
} from '../../admin-config/timelines/timeline-loads.js';
import { spAccessConfig } from '../../config/sp-access.config.js';
import { titleOf } from '../../ingestion/load-rules.js';
import { CatalogService } from '../../users/catalogs/catalog.service.js';
import { AssessmentService } from '../assessment.service.js';
import {
  ASSESSMENT_STORE,
  type AssessmentStore,
  type MembershipRecord,
} from '../assessment.store.js';
import {
  buildAssessmentView,
  type ViewField,
  type ViewSection,
} from '../assessment-view.js';
import {
  QA_STATUS_LABELS,
  QA_STATUSES,
  statusOf,
  type QaStatus,
} from '../qa-status.js';
import { audienceStepState } from '../role-steps.js';
import type { WorklistStep } from '../worklist.store.js';
import type { SpProgram } from './sp-access.service.js';
import type { SpSessionPrincipal } from './sp-access.store.js';
import {
  commentsVisibleIn,
  countsOf,
  toSpComments,
  type SpCommentView,
  type SpCounts,
} from './sp-thread.js';
import { SpNotFoundError, SpProgramRequiredError } from './sp-view.errors.js';
import {
  SP_VIEW_STORE,
  type SpTimelineRecord,
  type SpViewStore,
} from './sp-view.store.js';

/** The programs step of a timeline as the SP view shows it. */
export interface SpStepView {
  position: number;
  name: string;
  opensAt: RomeMinute;
  closesAt: RomeMinute;
  state: TimelineStepState;
}

export interface SpTimelinesResponse {
  timelines: Array<{
    id: number;
    name: string;
    kind: 'official' | 'additional';
    step: SpStepView | null;
  }>;
  defaultTimelineId: number | null;
}

export interface SpResultRow {
  resultCode: number;
  title: string | null;
  updated: boolean;
  resultType: { key: string; label: string };
  comments: number;
  answered: number;
  status: QaStatus | null;
}

export interface SpResultsResponse {
  rows: SpResultRow[];
  options: {
    statuses: Array<{ key: QaStatus; label: string }>;
    resultTypes: Array<{ key: string; label: string }>;
  };
  step: SpStepView | null;
}

export type SpViewFieldOut = Omit<ViewField, 'comments'> & {
  comments: SpCommentView[];
};

export interface SpResultResponse {
  header: {
    resultCode: number;
    title: string | null;
    program: SpProgram;
    resultType: { key: string; label: string };
    timeline: { id: number; name: string };
    status: QaStatus | null;
    reportingUrl: string | null;
  };
  step: SpStepView | null;
  sections: Array<Omit<ViewSection, 'fields'> & { fields: SpViewFieldOut[] }>;
  other: SpViewFieldOut[];
  writable: boolean;
  readOnlyReason: 'step_not_open' | 'step_closed' | null;
  counts: SpCounts;
}

export interface SpResultsFilters {
  statuses: readonly QaStatus[];
  resultTypeKeys: readonly string[];
}

/** A program the scope resolved, and the session it belongs to. */
interface ResolvedScope {
  program: SpProgram;
}

/** The resolved timeline of an SP route, judged at one Rome minute. */
export interface SpTimelineContext {
  timeline: SpTimelineRecord;
  step: SpStepView | null;
  stepState: TimelineStepState | null;
  /** Position of the assessors' step: the assessment the program reads the comments of. */
  assessmentStepPosition: number | null;
}

/** The access an SP read uses on the shared membership statement: every membership but `not_in_qa`. */
const READ_ALL = { admin: true, reviewerRows: [], disabledRoles: [] } as const;

@Injectable()
export class SpViewService {
  constructor(
    @Inject(SP_VIEW_STORE) private readonly store: SpViewStore,
    @Inject(ASSESSMENT_STORE) private readonly assessments: AssessmentStore,
    @Inject(AssessmentService) private readonly assessment: AssessmentService,
    @Inject(TIMELINE_LOADS) private readonly loads: TimelineLoads,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(ADMIN_CONFIG_CLOCK) private readonly clock: AdminConfigClock,
    @Inject(spAccessConfig.KEY)
    private readonly config: ConfigType<typeof spAccessConfig>,
  ) {}

  /**
   * The program a request reads. A non-admin session: its own program; any
   * other `programId` is the 404 of "does not exist". An admin session: the
   * `programId` it names (400 when missing), which must be a Science Program
   * of the catalog (404 otherwise).
   */
  async resolveProgram(
    session: SpSessionPrincipal,
    programId: number | undefined,
  ): Promise<ResolvedScope> {
    const programs = await this.catalog.listSciencePrograms();
    const describe = (id: number): SpProgram => {
      const found = programs.find((p) => p.id === id);
      return found === undefined
        ? { id, code: String(id), name: String(id) }
        : { id: found.id, code: found.code, name: found.name };
    };
    if (!session.isReportingAdmin) {
      if (session.programId === null) throw new SpNotFoundError();
      if (programId !== undefined && programId !== session.programId) {
        throw new SpNotFoundError();
      }
      return { program: describe(session.programId) };
    }
    if (programId === undefined) throw new SpProgramRequiredError();
    if (!programs.some((p) => p.id === programId)) throw new SpNotFoundError();
    return { program: describe(programId) };
  }

  /** The timelines of the active cycle covering the program, with their programs step. */
  async timelines(
    session: SpSessionPrincipal,
    programId: number | undefined,
  ): Promise<SpTimelinesResponse> {
    const { program } = await this.resolveProgram(session, programId);
    const found = await this.store.findTimelines(program.id);
    const withLoad = await this.loads.withLoad(found.map((x) => x.id));
    const now = nowInRome(this.clock());
    const timelines = found.map((timeline) => ({
      id: timeline.id,
      name: timeline.name,
      kind: timeline.kind,
      step: this.judge(timeline, now, withLoad.has(timeline.id)).step,
    }));
    return {
      timelines,
      defaultTimelineId: pickDefaultTimeline(timelines),
    };
  }

  /**
   * One timeline of the program, judged at the clock's Rome minute; a timeline
   * that is not the program's is the 404 of a missing one.
   */
  async timelineFor(
    programId: number,
    timelineId: number,
    at: Date,
  ): Promise<SpTimelineContext> {
    const [timeline] = await this.store.findTimelines(programId, timelineId);
    if (timeline === undefined) throw new SpNotFoundError();
    const hasLoad = (await this.loads.withLoad([timeline.id])).has(timeline.id);
    return this.judge(timeline, nowInRome(at), hasLoad);
  }

  private judge(
    timeline: SpTimelineRecord,
    now: RomeMinute,
    hasLoad: boolean,
  ): SpTimelineContext {
    const programsStep = timeline.steps.find((s) => s.audience === 'programs');
    const stepState = audienceStepState('programs', {
      steps: timeline.steps,
      now,
      hasLoad,
    });
    return {
      timeline,
      stepState,
      step:
        programsStep === undefined || stepState === null
          ? null
          : stepViewOf(programsStep, stepState),
      assessmentStepPosition:
        timeline.steps.find((s) => s.audience === 'assessors')?.position ??
        null,
    };
  }

  /** The program's results of a timeline, filtered server side; no paging. */
  async results(
    session: SpSessionPrincipal,
    timelineId: number,
    programId: number | undefined,
    filters: SpResultsFilters,
  ): Promise<SpResultsResponse> {
    const { program } = await this.resolveProgram(session, programId);
    const context = await this.timelineFor(
      program.id,
      timelineId,
      this.clock(),
    );
    const records = await this.store.listResults({
      timelineId: context.timeline.id,
      programId: program.id,
      assessmentStepPosition: context.assessmentStepPosition,
      commentsVisible: commentsVisibleIn(context.stepState),
    });
    const resultTypes = await this.catalog.listResultTypes();
    const labelOf = (key: string) =>
      resultTypes.find((x) => x.key === key)?.name ?? key;
    const all: SpResultRow[] = records.map((r) => ({
      resultCode: r.resultCode,
      title: r.title,
      updated: r.updated,
      resultType: { key: r.resultTypeKey, label: labelOf(r.resultTypeKey) },
      comments: r.comments,
      answered: r.answered,
      status: statusOf({
        membershipStatus: r.membershipStatus,
        endReason: r.endReason,
        assessmentStatus: r.assessmentStatus,
        hasClarificationThread: r.hasClarificationThread,
      }),
    }));
    const statuses = QA_STATUSES.filter((s) =>
      all.some((r) => r.status === s),
    ).map((key) => ({ key, label: QA_STATUS_LABELS[key] }));
    const typeKeys = [...new Set(all.map((r) => r.resultType.key))].sort(
      (x, y) => labelOf(x).localeCompare(labelOf(y)),
    );
    const rows = all.filter(
      (r) =>
        (filters.statuses.length === 0 ||
          (r.status !== null && filters.statuses.includes(r.status))) &&
        (filters.resultTypeKeys.length === 0 ||
          filters.resultTypeKeys.includes(r.resultType.key)),
    );
    return {
      rows,
      options: {
        statuses,
        resultTypes: typeKeys.map((key) => ({ key, label: labelOf(key) })),
      },
      step: context.step,
    };
  }

  /**
   * The membership of a result the program may read: round 1, of this
   * program, listed by the worklist's predicate. Anything else is the 404.
   */
  async membershipFor(
    programId: number,
    context: SpTimelineContext,
    resultCode: number,
  ): Promise<MembershipRecord> {
    const membership = await this.assessments.findMembership({
      timelineId: context.timeline.id,
      resultCode,
      access: READ_ALL,
      round: 1,
      // Round 1 only: the program never reads a round-2 step (round-2 FR-15).
      roundTwoStepPositions: [],
      assessmentStepPosition: context.assessmentStepPosition,
    });
    if (
      membership === null ||
      membership.programId !== programId ||
      membership.round !== 1 ||
      (membership.ended &&
        membership.endReason !== 'released_qaed' &&
        membership.endReason !== 'returned')
    ) {
      throw new SpNotFoundError();
    }
    return membership;
  }

  /** The SP-visible comments of a membership with their threads (none before the programs step). */
  async commentsOf(
    membership: MembershipRecord,
    context: SpTimelineContext,
  ): Promise<SpCommentView[]> {
    const assessment = membership.assessment;
    if (assessment === null || !commentsVisibleIn(context.stepState)) {
      return [];
    }
    const comments = await this.store.findVisibleComments(assessment.id);
    const ids = comments.map((x) => x.id);
    const [responses, answers] = await Promise.all([
      this.store.findResponses(ids),
      this.store.findClarificationAnswers(ids),
    ]);
    return toSpComments(comments, responses, answers);
  }

  /** The view of one result for the program (P2-3911). */
  async result(
    session: SpSessionPrincipal,
    timelineId: number,
    resultCode: number,
    programId: number | undefined,
  ): Promise<SpResultResponse> {
    const { program } = await this.resolveProgram(session, programId);
    const context = await this.timelineFor(
      program.id,
      timelineId,
      this.clock(),
    );
    const membership = await this.membershipFor(
      program.id,
      context,
      resultCode,
    );
    const { config, catalog, snapshot } = await this.assessment.viewInputsFor(
      context.timeline,
      membership,
    );
    const comments = await this.commentsOf(membership, context);
    const validations =
      membership.assessment === null
        ? []
        : await this.assessments.findValidations(membership.assessment.id);
    const view = buildAssessmentView({
      catalog,
      resultType: membership.resultTypeKey,
      config,
      values: snapshot.values,
      labels: snapshot.labels,
      validated: new Map(validations.map((v) => [v.fieldKey, v.validated])),
      // The assessor's comments never enter the view: the SP shape replaces them below.
      comments: [],
    });
    const byField = new Map<string, SpCommentView[]>();
    for (const comment of comments) {
      byField.set(comment.fieldKey, [
        ...(byField.get(comment.fieldKey) ?? []),
        comment,
      ]);
    }
    const withComments = (field: ViewField): SpViewFieldOut => ({
      ...field,
      comments: field.mode === 'assessed' ? (byField.get(field.key) ?? []) : [],
    });
    const resultTypes = await this.catalog.listResultTypes();
    const state = context.stepState;
    return {
      header: {
        resultCode: membership.resultCode,
        title: membership.title ?? titleOf(snapshot.values),
        program,
        resultType: {
          key: membership.resultTypeKey,
          label:
            resultTypes.find((x) => x.key === membership.resultTypeKey)?.name ??
            membership.resultTypeKey,
        },
        timeline: { id: context.timeline.id, name: context.timeline.name },
        status: statusOf({
          membershipStatus: membership.status,
          endReason: membership.endReason,
          assessmentStatus: membership.assessment?.status ?? null,
          hasClarificationThread: comments.some(
            (x) => x.state === 'clarification_requested',
          ),
        }),
        reportingUrl: this.reportingUrlOf(membership.resultCode),
      },
      step: context.step,
      sections: view.sections.map((section) => ({
        ...section,
        fields: section.fields.map(withComments),
      })),
      other: view.other.map(withComments),
      writable: state === 'in_progress',
      readOnlyReason:
        state === 'in_progress'
          ? null
          : state === 'closed'
            ? 'step_closed'
            : 'step_not_open',
      counts: countsOf(comments),
    };
  }

  /** "Open in Reporting": the configured template with the result code, or null. */
  reportingUrlOf(resultCode: number): string | null {
    const template = this.config.reportingResultUrl;
    return template === undefined
      ? null
      : template.split('{resultCode}').join(encodeURIComponent(resultCode));
  }
}

function stepViewOf(step: WorklistStep, state: TimelineStepState): SpStepView {
  return {
    position: step.position,
    name: step.name,
    opensAt: step.opensAt,
    closesAt: step.closesAt,
    state,
  };
}
