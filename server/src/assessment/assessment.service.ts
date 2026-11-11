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
  type FieldConfigEffective,
} from '../admin-config/field-config/field-config.module.js';
import { nowInRome } from '../admin-config/rome-date.js';
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
  AssessmentNoFieldConfigError,
  AssessmentNotFoundError,
} from './assessment.errors.js';
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
  ) {}

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
    try {
      const effective = await this.fieldConfig.effectiveFor(
        timeline.cycleId,
        timeline.id,
        membership.resultTypeKey,
      );
      return effective.items;
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
