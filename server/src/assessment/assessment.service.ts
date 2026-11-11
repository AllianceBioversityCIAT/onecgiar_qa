// @akili-spec assessment/step-1-assessment
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ADMIN_CONFIG_CLOCK,
  type AdminConfigClock,
} from '../admin-config/admin-config.clock.js';
import {
  FieldConfigCatalogMissingError,
  FieldConfigNoVersionError,
  FieldConfigTypeNotInTimelineError,
  TimelineNotFoundError,
} from '../admin-config/admin-config.errors.js';
import {
  FIELD_CATALOG_SOURCE,
  type FieldCatalogSource,
} from '../admin-config/field-config/field-catalog.ports.js';
import type { ConfigItem } from '../admin-config/field-config/field-config-diff.js';
import {
  FIELD_CONFIG_EFFECTIVE,
  type EffectiveFieldConfig,
  type FieldConfigEffective,
} from '../admin-config/field-config/field-config.module.js';
import { nowInRome, type RomeMinute } from '../admin-config/rome-date.js';
import {
  TIMELINE_LOADS,
  type TimelineLoads,
} from '../admin-config/timelines/timeline-loads.js';
import { snapshotKeyOf, titleOf } from '../ingestion/load-rules.js';
import {
  SNAPSHOT_STORE,
  type ResultSnapshotRecord,
  type SnapshotStore,
} from '../ingestion/snapshot-store.port.js';
import { AuthorizationService } from '../users/authorization.service.js';
import { CatalogService } from '../users/catalogs/catalog.service.js';
import type { AuthenticatedUser } from '../users/current-user.cache.js';
import { Permission } from '../users/permissions.js';
import {
  AssessmentFieldKeysInvalidError,
  AssessmentFinishedError,
  AssessmentNoFieldConfigError,
  AssessmentNotFoundError,
  AssessmentReadOnlyError,
  AssessmentStepClosedError,
} from './assessment.errors.js';
import {
  ASSESSMENT_UNIT_OF_WORK,
  type AssessmentUnitOfWork,
} from './assessment.unit-of-work.js';
import {
  ASSESSMENT_STORE,
  type AssessmentStore,
  type CommentRecord,
  type MembershipRecord,
} from './assessment.store.js';
import {
  buildAssessmentView,
  type ViewComment,
  type ViewSection,
  type ViewField,
} from './assessment-view.js';
import type { QaStatus } from './qa-status.js';
import { statusOf } from './qa-status.js';
import { enabledReviewerRows, type StepTiming } from './role-steps.js';
import {
  resolveAccess,
  writeDecision,
  type ReadOnlyReason,
  type WorklistAccess,
  type WriteDecision,
} from './scope.js';
import {
  WORKLIST_STORE,
  type WorklistStore,
  type WorklistTimeline,
} from './worklist.store.js';

/** Why the caller cannot write: the T-3 reasons, plus the end of the assessment (FR-16). */
export type AssessmentReadOnlyReason = ReadOnlyReason | 'finished';

export interface AssessmentHeader {
  resultCode: number;
  title: string | null;
  program: { id: number; code: string; name: string };
  resultType: { key: string; label: string };
  timeline: { id: number; name: string };
  /** The role's step; null when the timeline has none. */
  step: { position: number; name: string } | null;
  status: QaStatus | null;
}

export interface AssessmentSummary {
  status: 'pending' | 'quality_assessed' | 'returned';
  assessedBy: { id: number; nickname: string | null } | null;
  finishedAt: string | null;
}

/** The request of `PUT …/assessment/validations`: the new state, and the fields it applies to (exactly one of the two selectors, FR-10). */
export interface ValidateInput {
  validated: boolean;
  fieldKeys?: readonly string[];
  all?: boolean;
}

/** The answer of a validation write: the assessment's end state and every validation row it holds (design 6). */
export interface ValidationSummary extends AssessmentSummary {
  validations: Array<{ fieldKey: string; validated: boolean }>;
}

/** The answer of `GET …/results/:resultCode/assessment` (design 6). */
export interface AssessmentViewResponse {
  header: AssessmentHeader;
  sections: ViewSection[];
  other: ViewField[];
  writable: boolean;
  readOnlyReason: AssessmentReadOnlyReason | null;
  assessment: AssessmentSummary | null;
}

const toViewComment = (row: CommentRecord): ViewComment => ({
  id: row.id,
  fieldKey: row.fieldKey,
  author: { id: row.authorId, nickname: row.authorNickname },
  body: row.body,
  state: row.state,
  stepPosition: row.stepPosition,
  round: row.round,
  valueCopy: row.valueCopy,
  valueTruncated: row.valueTruncated,
  createdAt: row.createdAt.toISOString(),
  withdrawnAt: row.withdrawnAt === null ? null : row.withdrawnAt.toISOString(),
});

@Injectable()
export class AssessmentService {
  private readonly logger = new Logger(AssessmentService.name);

  constructor(
    @Inject(ASSESSMENT_STORE) private readonly store: AssessmentStore,
    @Inject(WORKLIST_STORE) private readonly worklist: WorklistStore,
    @Inject(TIMELINE_LOADS) private readonly loads: TimelineLoads,
    @Inject(SNAPSHOT_STORE) private readonly snapshots: SnapshotStore,
    @Inject(FIELD_CATALOG_SOURCE) private readonly catalogs: FieldCatalogSource,
    @Inject(FIELD_CONFIG_EFFECTIVE)
    private readonly fieldConfig: FieldConfigEffective,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    private readonly authorization: AuthorizationService,
    @Inject(ADMIN_CONFIG_CLOCK) private readonly clock: AdminConfigClock,
    @Inject(ASSESSMENT_UNIT_OF_WORK)
    private readonly unitOfWork: AssessmentUnitOfWork,
  ) {}

  /**
   * FR-2, FR-10, FR-16, FR-21 (design 7.5): set one or more Assessed fields
   * green or grey, or every Assessed field (check all). The clock is read ONCE;
   * the same minute judges the step before the transaction and again under the
   * timeline lock (NFR-4).
   *
   * Before the transaction (no lock): the membership is resolved inside the
   * caller's scope (404, the same one the read answers), the step is judged
   * (403 `ASSESSMENT_READ_ONLY` for an ADMIN with no reviewer row, 409
   * `ASSESSMENT_STEP_CLOSED`), an ended assessment is refused (409
   * `ASSESSMENT_FINISHED`), and the keys are checked against the Assessed fields
   * of the PINNED version (400 naming each wrong key). A request that only greys
   * fields of an assessment that does not exist yet is answered without writing:
   * there is nothing to undo, and a no-op creates no row.
   *
   * In the transaction, in the lock order of design 5: the timeline `FOR SHARE`
   * (its steps are re-judged with the same minute), the assessment row created
   * on the first write and locked `FOR UPDATE`, and only then the status read as
   * it is under the lock (a finish that committed after the first read refuses
   * there, 409 `ASSESSMENT_FINISHED`). Only the fields whose state changes are
   * written, and one audit row names them; a request that changes nothing writes
   * no validation and no audit row. This task never ends the assessment (the
   * end rule is T-11).
   */
  async validate(
    user: AuthenticatedUser,
    timelineId: number,
    resultCode: number,
    input: ValidateInput,
    requestId: string,
  ): Promise<ValidationSummary> {
    const at = this.clock();
    const now = nowInRome(at);

    const { timeline, access, membership, facts, hasLoad, decision, readStep } =
      await this.resolveWrite(user, timelineId, resultCode, now);
    const stepPosition = decision.stepPosition;
    const held =
      membership.assessment !== null && readStep === stepPosition
        ? membership.assessment
        : null;

    // FR-16: an ended membership or assessment takes no more validations.
    if (membership.ended || (held !== null && held.status !== 'pending')) {
      throw new AssessmentFinishedError();
    }

    // The pinned version when the row exists, the timeline's when it does not (DD-3).
    let items: readonly ConfigItem[];
    let version: number;
    if (held !== null) {
      if (held.fieldConfigVersionId === null) {
        throw new AssessmentNoFieldConfigError();
      }
      items = await this.fieldConfig.versionItems(
        held.fieldConfigVersionId,
        membership.resultTypeKey,
      );
      version = held.fieldConfigVersion;
    } else {
      const effective = await this.effectiveConfig(
        timeline,
        membership.resultTypeKey,
      );
      items = effective.items;
      version = effective.version;
    }
    const assessed = items
      .filter(
        (item) =>
          item.resultTypeKey === membership.resultTypeKey &&
          item.visibility === 'assessed',
      )
      .map((item) => item.fieldKey);
    const target =
      input.all === true ? assessed : [...new Set(input.fieldKeys ?? [])];
    const wrong = target.filter((key) => !assessed.includes(key));
    if (wrong.length > 0) throw new AssessmentFieldKeysInvalidError(wrong);

    // Nothing to undo before the first write: no row, no transaction, no audit.
    if (held === null && !input.validated) {
      return {
        status: 'pending',
        assessedBy: null,
        finishedAt: null,
        validations: [],
      };
    }

    return await this.unitOfWork.run(async ({ assessments }) => {
      const steps = await assessments.lockTimelineShared(timeline.id);
      if (steps === null) throw new AssessmentNotFoundError();
      // The same minute, the steps as they are under the share lock (design 7.5, step 3).
      this.assertWritable(writeDecision(access, facts, { steps, now, hasLoad }));
      if (held === null) {
        await assessments.ensureAssessment({
          timelineResultId: membership.membershipId,
          stepPosition,
          roleCode: decision.row.role,
          fieldConfigVersion: version,
          createdBy: user.id,
          at,
        });
      }
      const locked = await assessments.lockAssessment(
        membership.membershipId,
        stepPosition,
      );
      // The row was created or seen a moment ago and is never deleted: a miss is a defect, not a user error.
      if (locked === undefined) throw new Error('assessment_row_missing');
      // FR-16, UNDER the lock: this read decides (a finish may have committed since the first one).
      if (locked.status !== 'pending') throw new AssessmentFinishedError();

      const state = new Map(
        (await assessments.findValidations(locked.id)).map((row) => [
          row.fieldKey,
          row.validated,
        ]),
      );
      // A field with no row is grey: writing grey to it changes nothing (FR-10).
      const changed = target.filter(
        (key) => (state.get(key) ?? false) !== input.validated,
      );
      if (changed.length > 0) {
        await assessments.upsertValidations(
          locked.id,
          changed.map((fieldKey) => ({ fieldKey, validated: input.validated })),
          user.id,
          at,
        );
        await assessments.insertAudit({
          assessmentId: locked.id,
          actorId: user.id,
          action:
            input.all === true
              ? input.validated
                ? 'check_all'
                : 'uncheck_all'
              : input.validated
                ? 'validate'
                : 'unvalidate',
          fieldKeys: changed,
          commentId: null,
          requestId,
          at,
        });
        for (const key of changed) state.set(key, input.validated);
      }
      return {
        status: locked.status,
        assessedBy: null,
        finishedAt: null,
        validations: [...state]
          .map(([fieldKey, validated]) => ({ fieldKey, validated }))
          .sort((x, y) => (x.fieldKey < y.fieldKey ? -1 : 1)),
      };
    });
  }

  /**
   * Steps 1 and 2 of a write (design 7.5): the timeline, the caller's rows and
   * the membership inside them (one 404 for "not yours" and "not there"), then
   * the step judged at `now`. Three statements, as the read's first three: the
   * timeline and rows, the membership, the load probe.
   */
  private async resolveWrite(
    user: AuthenticatedUser,
    timelineId: number,
    resultCode: number,
    now: RomeMinute,
  ) {
    const [timeline] = await this.worklist.findTimelines(user.id, timelineId);
    if (timeline === undefined) throw new AssessmentNotFoundError();
    const admin = this.authorization.can(user, Permission.ADMIN_ACCESS);
    const access = resolveAccess(user, timeline.roleCodes, admin);
    if (!admin && access.reviewerRows.length === 0) {
      throw new AssessmentNotFoundError();
    }
    const readStep = this.assessmentStep(timeline, access);
    const membership = await this.store.findMembership({
      timelineId: timeline.id,
      resultCode,
      access,
      round: null,
      assessmentStepPosition: readStep,
    });
    if (membership === null) throw new AssessmentNotFoundError();
    const hasLoad = (await this.loads.withLoad([timeline.id])).has(timeline.id);
    const facts = {
      resultType: membership.resultTypeKey,
      programId: membership.programId,
      round: membership.round,
      status: membership.status,
      ended: membership.ended,
      endReason: membership.endReason,
    };
    const decision = this.assertWritable(
      writeDecision(access, facts, { steps: timeline.steps, now, hasLoad }),
    );
    return { timeline, access, membership, facts, hasLoad, decision, readStep };
  }

  /** The refusal of a write decision: 404 (not in scope), 403 (an ADMIN with no reviewer row), 409 (the step is not open). */
  private assertWritable(
    decision: WriteDecision,
  ): Extract<WriteDecision, { writable: true }> {
    if (decision.writable) return decision;
    switch (decision.reason) {
      case 'not_in_scope':
        throw new AssessmentNotFoundError();
      case 'admin_read_only':
        throw new AssessmentReadOnlyError();
      default:
        throw new AssessmentStepClosedError();
    }
  }

  /**
   * FR-1, FR-2, FR-8, FR-9, FR-11 (read): the assessment view of one result.
   * Statements (NFR-2): the timeline and the caller's rows, whether it holds a
   * load, the membership with its assessment and the pinned version's id (three),
   * then the configuration. With no assessment row `effectiveFor` runs five
   * (three of `listTimelineStarts`, `listVersions`, `listVersionItems`): eight
   * in all. With a row, the items of its pinned version are one statement and
   * the validations and comments two more: six in all, whatever the size of the
   * result. One snapshot GetItem. A read never writes (DD-3).
   *
   * An out-of-scope result, a result that does not exist and a timeline that is
   * not the caller's are one and the same 404 (FR-1 *Out-of-scope result by
   * URL*): nothing tells them apart.
   */
  async open(
    user: AuthenticatedUser,
    timelineId: number,
    resultCode: number,
    round?: number,
  ): Promise<AssessmentViewResponse> {
    const [timeline] = await this.worklist.findTimelines(user.id, timelineId);
    if (timeline === undefined) throw new AssessmentNotFoundError();
    const admin = this.authorization.can(user, Permission.ADMIN_ACCESS);
    const access = resolveAccess(user, timeline.roleCodes, admin);
    if (!admin && access.reviewerRows.length === 0) {
      throw new AssessmentNotFoundError();
    }
    const stepPosition = this.assessmentStep(timeline, access);

    const membership = await this.store.findMembership({
      timelineId: timeline.id,
      resultCode,
      access,
      round: round ?? null,
      assessmentStepPosition: stepPosition,
    });
    if (membership === null) throw new AssessmentNotFoundError();

    const timing: StepTiming = {
      steps: timeline.steps,
      now: nowInRome(this.clock()),
      hasLoad: (await this.loads.withLoad([timeline.id])).has(timeline.id),
    };

    // 409 and 503 come before any structure is built: never a guessed page (FR-8).
    const config = await this.configOf(timeline, membership);
    const catalog = await this.catalogOf(membership.cycleYear);
    const snapshot = await this.snapshotOf(membership);

    const assessment = membership.assessment;
    const [validations, comments] =
      assessment === null
        ? [[], []]
        : await Promise.all([
            this.store.findValidations(assessment.id),
            this.store.findComments(assessment.id),
          ]);
    const [programs, resultTypes] = await Promise.all([
      this.catalog.listSciencePrograms(),
      this.catalog.listResultTypes(),
    ]);

    const view = buildAssessmentView({
      catalog,
      resultType: membership.resultTypeKey,
      config,
      values: snapshot.values,
      labels: snapshot.labels,
      validated: new Map(validations.map((v) => [v.fieldKey, v.validated])),
      comments: comments.map(toViewComment),
    });

    const decision = writeDecision(
      access,
      {
        resultType: membership.resultTypeKey,
        programId: membership.programId,
        round: membership.round,
        status: membership.status,
        ended: membership.ended,
        endReason: membership.endReason,
      },
      timing,
    );
    // FR-16: once the assessment ended, nothing is accepted on it.
    const finished = assessment !== null && assessment.status !== 'pending';
    const readOnlyReason: AssessmentReadOnlyReason | null = !decision.writable
      ? decision.reason === 'not_in_scope'
        ? 'admin_read_only'
        : decision.reason
      : finished
        ? 'finished'
        : null;

    const program = programs.find((p) => p.id === membership.programId);
    const step =
      stepPosition === null
        ? undefined
        : timeline.steps.find((s) => s.position === stepPosition);
    return {
      header: {
        resultCode: membership.resultCode,
        title: membership.title ?? titleOf(snapshot.values),
        program: {
          id: membership.programId,
          code: program?.code ?? String(membership.programId),
          name: program?.name ?? String(membership.programId),
        },
        resultType: {
          key: membership.resultTypeKey,
          label:
            resultTypes.find((t) => t.key === membership.resultTypeKey)?.name ??
            membership.resultTypeKey,
        },
        timeline: { id: timeline.id, name: timeline.name },
        step:
          step === undefined
            ? null
            : { position: step.position, name: step.name },
        status: statusOf({
          membershipStatus: membership.status,
          endReason: membership.endReason,
          assessmentStatus: assessment?.status ?? null,
          hasClarificationThread: comments.some(
            (c) => c.state === 'clarification_requested',
          ),
        }),
      },
      sections: view.sections,
      other: view.other,
      writable: readOnlyReason === null,
      readOnlyReason,
      assessment:
        assessment === null
          ? null
          : {
              status: assessment.status,
              assessedBy:
                assessment.finishedById === null
                  ? null
                  : {
                      id: assessment.finishedById,
                      nickname: assessment.finishedByNickname,
                    },
              finishedAt:
                assessment.finishedAt === null
                  ? null
                  : assessment.finishedAt.toISOString(),
            },
    };
  }

  /**
   * The items the view follows (design 7.4, DD-3, P-16). With an assessment
   * row, the items of the version it PINNED, in one statement (the membership
   * statement already returned the version's id). With none, `effectiveFor`
   * resolves the timeline's version (five statements). No version, or a type
   * the timeline does not cover: 409 `ASSESSMENT_NO_FIELD_CONFIG`. A timeline
   * that vanished between two reads is the same 404 as any result not seen.
   */
  private async configOf(
    timeline: WorklistTimeline,
    membership: MembershipRecord,
  ): Promise<readonly ConfigItem[]> {
    const pinned = membership.assessment;
    if (pinned !== null) {
      // A pinned number with no version row is a defect: no structure is guessed.
      if (pinned.fieldConfigVersionId === null) {
        throw new AssessmentNoFieldConfigError();
      }
      return await this.fieldConfig.versionItems(
        pinned.fieldConfigVersionId,
        membership.resultTypeKey,
      );
    }
    return (await this.effectiveConfig(timeline, membership.resultTypeKey))
      .items;
  }

  /** What the timeline resolves to now (five statements): no version, or a type it does not cover, is the 409; a vanished timeline the 404. */
  private async effectiveConfig(
    timeline: WorklistTimeline,
    resultTypeKey: string,
  ): Promise<EffectiveFieldConfig> {
    try {
      return await this.fieldConfig.effectiveFor(
        timeline.cycleId,
        timeline.id,
        resultTypeKey,
      );
    } catch (error) {
      if (
        error instanceof FieldConfigNoVersionError ||
        error instanceof FieldConfigTypeNotInTimelineError
      ) {
        throw new AssessmentNoFieldConfigError();
      }
      if (error instanceof TimelineNotFoundError) {
        throw new AssessmentNotFoundError();
      }
      throw error;
    }
  }

  /** The catalog of the cycle's year. A catalog that cannot be read is the catalog source's own 503; one Reporting does not have is the same 409 as no configuration. */
  private async catalogOf(year: number) {
    try {
      return await this.catalogs.forYear(year);
    } catch (error) {
      if (error instanceof FieldConfigCatalogMissingError) {
        throw new AssessmentNoFieldConfigError();
      }
      throw error;
    }
  }

  /** One GetItem through `snapshotKeyOf`, the strip the loader's key needs (DD-7, P-7). */
  private async snapshotOf(
    membership: MembershipRecord,
  ): Promise<ResultSnapshotRecord> {
    const snapshot = await this.snapshots.get(
      membership.resultCode,
      snapshotKeyOf(membership.snapshotSk),
    );
    if (snapshot === null) {
      // The snapshot is written before its membership and never deleted: a miss is a defect, not a user error.
      this.logger.error(
        `assessment_snapshot_missing membership=${membership.membershipId}`,
      );
      throw new Error('assessment_snapshot_missing');
    }
    return snapshot;
  }

  /** The step whose assessment is read: the first reviewer row's, else the enabled reviewer role's (an ADMIN reads the same step). */
  private assessmentStep(
    timeline: WorklistTimeline,
    access: WorklistAccess,
  ): number | null {
    const audience =
      access.reviewerRows[0]?.audience ?? enabledReviewerRows()[0]?.audience;
    return (
      timeline.steps.find((step) => step.audience === audience)?.position ??
      null
    );
  }
}
