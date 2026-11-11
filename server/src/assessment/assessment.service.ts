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
import type { IdempotencyHandle } from '../common/idempotency/idempotency.context.js';
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
  AssessmentBusyError,
  AssessmentCommentFieldInvalidError,
  AssessmentCommentNotOpenError,
  AssessmentCoreUncommentedError,
  AssessmentFieldKeysInvalidError,
  AssessmentFinishedError,
  AssessmentNoFieldConfigError,
  AssessmentNotCommentAuthorError,
  AssessmentNotFoundError,
  AssessmentReadOnlyError,
  AssessmentStepClosedError,
} from './assessment.errors.js';
import { loggedWrite, type WriteLogTrace } from './assessment-log.js';
import {
  ASSESSMENT_UNIT_OF_WORK,
  type AssessmentUnitOfWork,
} from './assessment.unit-of-work.js';
import {
  ASSESSMENT_STORE,
  type AssessmentStore,
  type AssessmentWriteStore,
  type CommentRecord,
  type LockedAssessment,
  type MembershipRecord,
} from './assessment.store.js';
import {
  endAfterValidation,
  endOnFinish,
  type CoreFieldState,
} from './assessment-rules.js';
import {
  buildAssessmentView,
  type ViewComment,
  type ViewSection,
  type ViewField,
} from './assessment-view.js';
import type { QaStatus } from './qa-status.js';
import { statusOf } from './qa-status.js';
import {
  RELEASE_DISPATCHER,
  type ReleaseDispatcher,
} from './release.service.js';
import { buildValueCopy } from './comment-value-copy.js';
import {
  enabledReviewerRows,
  isWithdrawWindowOpen,
  type StepTiming,
} from './role-steps.js';
import {
  resolveAccess,
  writeDecision,
  type MembershipFacts,
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

/** The request of `POST …/assessment/comments`: a field and a body already trimmed and length-checked by the DTO. */
export interface CommentInput {
  fieldKey: string;
  body: string;
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

/** A datetime column keeps whole seconds, so a stamp is cut to them: what an answer says is then what a re-read gives. */
const wholeSecond = (at: Date): Date =>
  new Date(Math.floor(at.getTime() / 1000) * 1000);

/**
 * Raised under the assessment lock when the row pins another field-configuration
 * version than the one the request judged its keys by: a second first writer
 * created the row with a version the first request did not read (T-10). The
 * transaction rolls back and the request runs once more, now against the row.
 */
class PinnedVersionChangedError extends Error {}

/** What the transaction of a write knows before the lock: the request side of design 7.5. */
interface WriteContext {
  timeline: WorklistTimeline;
  access: WorklistAccess;
  membership: MembershipRecord;
  facts: MembershipFacts;
  hasLoad: boolean;
  now: RomeMinute;
  at: Date;
  stepPosition: number;
  roleCode: string;
  /** The assessment row as the first read saw it; `null` = it did not exist. */
  held: MembershipRecord['assessment'];
  /** The version the request judged its keys by. */
  version: number;
  user: AuthenticatedUser;
}

/** The end an in-transaction write applied. */
type EndStatus = 'quality_assessed' | 'returned';

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
    @Inject(RELEASE_DISPATCHER) private readonly releases: ReleaseDispatcher,
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
   * no validation and no audit row. A write that leaves every core field green
   * ends the assessment in the same transaction (FR-14, OQ-2, `applyEnd`).
   */
  async validate(
    user: AuthenticatedUser,
    timelineId: number,
    resultCode: number,
    input: ValidateInput,
    requestId: string,
  ): Promise<ValidationSummary> {
    return await loggedWrite(
      this.logger,
      { action: 'validate', actorId: user.id, requestId, timelineId },
      async (trace) => {
        const at = this.clock();
        const summary = await this.withPinnedRetry(() =>
          this.validateAt(
            at,
            user,
            timelineId,
            resultCode,
            input,
            requestId,
            trace,
          ),
        );
        // Only a write that ended the assessment queued a release.
        if (summary.status !== 'pending') this.dispatchRelease();
        return summary;
      },
    );
  }

  private async validateAt(
    at: Date,
    user: AuthenticatedUser,
    timelineId: number,
    resultCode: number,
    input: ValidateInput,
    requestId: string,
    trace: WriteLogTrace,
  ): Promise<ValidationSummary> {
    const now = nowInRome(at);

    const { timeline, access, membership, facts, hasLoad, decision, readStep } =
      await this.resolveWrite(user, timelineId, resultCode, now);
    trace.membershipId = membership.membershipId;
    const stepPosition = decision.stepPosition;
    const held =
      membership.assessment !== null && readStep === stepPosition
        ? membership.assessment
        : null;

    // FR-16: an ended membership or assessment takes no more validations.
    if (membership.ended || (held !== null && held.status !== 'pending')) {
      throw new AssessmentFinishedError();
    }

    const { assessed, core, version } = await this.assessedOf(
      timeline,
      membership,
      held,
    );
    const target =
      input.all === true ? assessed : [...new Set(input.fieldKeys ?? [])];
    const wrong = target.filter((key) => !assessed.includes(key));
    if (wrong.length > 0) throw new AssessmentFieldKeysInvalidError(wrong);

    // Nothing to write before the first write: no row, no transaction, no audit
    // (DD-3, "created lazily"). Greying fields has nothing to undo, and a check
    // all that targets no Assessed field has nothing to set.
    if (held === null && (!input.validated || target.length === 0)) {
      return {
        status: 'pending',
        assessedBy: null,
        finishedAt: null,
        validations: [],
      };
    }

    const context: WriteContext = {
      timeline,
      access,
      membership,
      facts,
      hasLoad,
      now,
      at,
      stepPosition,
      roleCode: decision.row.role,
      held,
      version,
      user,
    };
    return await this.unitOfWork.run(async ({ assessments }) => {
      const locked = await this.lockForWrite(assessments, context);

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
      // FR-14 (OQ-2): the write that leaves every core field green ends the assessment, in this transaction.
      // Only a write that turned something green can complete the core; a configuration with no core field never ends here.
      let end: AssessmentSummary = {
        status: locked.status,
        assessedBy: null,
        finishedAt: null,
      };
      if (
        changed.length > 0 &&
        input.validated &&
        endAfterValidation(
          core.map((key) => ({
            key,
            validated: state.get(key) ?? false,
            commented: false,
          })),
        ) === 'quality_assessed'
      ) {
        end = await this.applyEnd(
          assessments,
          context,
          locked,
          'quality_assessed',
          requestId,
        );
      }
      return { ...end, validations: this.validationRows(state) };
    });
  }

  /**
   * FR-14, FR-15, FR-16, FR-17, FR-21 (design 7.5, DD-5): Finish assessment.
   * The same steps as a validation, in the same lock order. Under the
   * assessment lock the end rule reads the core fields of the PINNED version:
   * none, or none grey, ends it `quality_assessed` (OQ-2); a grey core field
   * with no non-withdrawn comment is a 409 `ASSESSMENT_CORE_UNCOMMENTED` naming
   * the keys (OQ-9); otherwise it is `returned`. Either way Assessed by is the
   * caller. The end is ONE conditional UPDATE on `status = 'pending'`: of
   * several concurrent finishes the database lets one through and the others
   * get 409 `ASSESSMENT_FINISHED`, whatever the order they read the row in.
   * The release row, the comment visibility and the end audit row are written
   * after it, so a loser writes none of them. The clock is read once.
   */
  async finish(
    user: AuthenticatedUser,
    timelineId: number,
    resultCode: number,
    requestId: string,
  ): Promise<ValidationSummary> {
    return await loggedWrite(
      this.logger,
      { action: 'finish', actorId: user.id, requestId, timelineId },
      async (trace) => {
        const at = this.clock();
        const summary = await this.withPinnedRetry(() =>
          this.finishAt(at, user, timelineId, resultCode, requestId, trace),
        );
        this.dispatchRelease();
        return summary;
      },
    );
  }

  /**
   * After an end COMMITTED (DD-5): sends the queued release without making the
   * request wait. It is never awaited (NFR-6): Reporting being slow or down
   * must not slow or fail the end, which is already answered. A failure is
   * logged here; the row stays `pending` and the next dispatch sends it.
   */
  private dispatchRelease(): void {
    this.releases.dispatch().catch((error: unknown) => {
      this.logger.error(
        `assessment_release_dispatch_failed ${error instanceof Error ? error.name : 'error'}`,
      );
    });
  }

  private async finishAt(
    at: Date,
    user: AuthenticatedUser,
    timelineId: number,
    resultCode: number,
    requestId: string,
    trace: WriteLogTrace,
  ): Promise<ValidationSummary> {
    const now = nowInRome(at);
    const { timeline, access, membership, facts, hasLoad, decision, readStep } =
      await this.resolveWrite(user, timelineId, resultCode, now);
    trace.membershipId = membership.membershipId;
    const stepPosition = decision.stepPosition;
    const held =
      membership.assessment !== null && readStep === stepPosition
        ? membership.assessment
        : null;

    // FR-16: an ended membership or assessment takes no finish.
    if (membership.ended || (held !== null && held.status !== 'pending')) {
      throw new AssessmentFinishedError();
    }

    const { core, version } = await this.assessedOf(timeline, membership, held);
    const context: WriteContext = {
      timeline,
      access,
      membership,
      facts,
      hasLoad,
      now,
      at,
      stepPosition,
      roleCode: decision.row.role,
      held,
      version,
      user,
    };
    return await this.unitOfWork.run(async ({ assessments }) => {
      const locked = await this.lockForWrite(assessments, context);
      const state = new Map(
        (await assessments.findValidations(locked.id)).map((row) => [
          row.fieldKey,
          row.validated,
        ]),
      );
      const commented = new Set(
        await assessments.findCommentedFieldKeys(locked.id),
      );
      const coreStates: CoreFieldState[] = core.map((key) => ({
        key,
        validated: state.get(key) ?? false,
        commented: commented.has(key),
      }));
      const outcome = endOnFinish(coreStates);
      if (typeof outcome === 'object') {
        // Rolls the transaction back: a row created for this request goes with it.
        throw new AssessmentCoreUncommentedError([...outcome.fieldKeys]);
      }
      const end = await this.applyEnd(
        assessments,
        context,
        locked,
        outcome,
        requestId,
      );
      return { ...end, validations: this.validationRows(state) };
    });
  }

  /** Every validation row as the answer lists it, by field key. */
  private validationRows(
    state: ReadonlyMap<string, boolean>,
  ): ValidationSummary['validations'] {
    return [...state]
      .map(([fieldKey, validated]) => ({ fieldKey, validated }))
      .sort((x, y) => (x.fieldKey < y.fieldKey ? -1 : 1));
  }

  /**
   * The first steps of every write under the lock, in the lock order of design
   * 5: the timeline `FOR SHARE` (the steps are judged again with the same
   * minute, and the step the role writes in must still be the position the
   * request judged), the assessment row created on the first write and locked
   * `FOR UPDATE`, then the facts read UNDER that lock: an ended membership or
   * a status that is no longer `pending` is 409 `ASSESSMENT_FINISHED` (FR-16),
   * and a row that pins another version than the request judged by sends the
   * request round once more (`PinnedVersionChangedError`).
   */
  private async lockForWrite(
    assessments: AssessmentWriteStore,
    context: WriteContext,
  ): Promise<LockedAssessment> {
    const { timeline, membership, stepPosition } = context;
    const steps = await assessments.lockTimelineShared(timeline.id);
    if (steps === null) throw new AssessmentNotFoundError();
    // The same minute, the steps as they are under the share lock (design 7.5, step 3).
    const rejudged = this.assertWritable(
      writeDecision(context.access, context.facts, {
        steps,
        now: context.now,
        hasLoad: context.hasLoad,
      }),
    );
    if (rejudged.stepPosition !== stepPosition) {
      throw new AssessmentStepClosedError();
    }
    if (context.held === null) {
      await assessments.ensureAssessment({
        timelineResultId: membership.membershipId,
        stepPosition,
        roleCode: context.roleCode,
        fieldConfigVersion: context.version,
        createdBy: context.user.id,
        at: context.at,
      });
    }
    const locked = await assessments.lockAssessment(
      membership.membershipId,
      stepPosition,
    );
    // The row was created or seen a moment ago and is never deleted: a miss is a defect, not a user error.
    if (locked === undefined) throw new Error('assessment_row_missing');
    // FR-16, UNDER the lock: these reads decide (an end may have committed since the first read).
    if (locked.membershipEnded || locked.status !== 'pending') {
      throw new AssessmentFinishedError();
    }
    if (locked.fieldConfigVersion !== context.version) {
      throw new PinnedVersionChangedError();
    }
    return locked;
  }

  /**
   * The end of an assessment, under its lock (design 7.5): the conditional
   * UPDATE first (0 rows is 409 `ASSESSMENT_FINISHED`, and nothing else was
   * written), then the one release row, the comments becoming visible to the
   * program, and the end audit row. `quality_assessed` queues a `qaed`
   * release, `returned` a `not_qaed` one (FR-18). T-12 dispatches it.
   */
  private async applyEnd(
    assessments: AssessmentWriteStore,
    context: WriteContext,
    locked: LockedAssessment,
    status: EndStatus,
    requestId: string,
  ): Promise<AssessmentSummary> {
    const { membership, user, at } = context;
    const finishedAt = wholeSecond(at);
    const ended = await assessments.endAssessment({
      assessmentId: locked.id,
      status,
      actorId: user.id,
      at: finishedAt,
    });
    if (!ended) throw new AssessmentFinishedError();
    await assessments.insertRelease({
      assessmentId: locked.id,
      timelineResultId: membership.membershipId,
      resultId: membership.resultId,
      phaseYear: membership.phaseYear,
      outcome: status === 'quality_assessed' ? 'qaed' : 'not_qaed',
      at: finishedAt,
    });
    await assessments.markCommentsVisible(locked.id, finishedAt);
    await assessments.insertAudit({
      assessmentId: locked.id,
      actorId: user.id,
      action:
        status === 'quality_assessed' ? 'end_quality_assessed' : 'end_returned',
      fieldKeys: null,
      commentId: null,
      requestId,
      at,
    });
    return {
      status,
      assessedBy: { id: user.id, nickname: user.nickname },
      finishedAt: finishedAt.toISOString(),
    };
  }

  /**
   * Runs a write once more when it found, under the lock, another pinned
   * version than it judged by. A second mismatch is 503 `SERVICE_UNAVAILABLE`
   * (`AssessmentBusyError`), retryable and with nothing written, never an
   * unhandled error that the filter turns into a 500.
   */
  private async withPinnedRetry<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof PinnedVersionChangedError)) throw error;
    }
    try {
      return await run();
    } catch (error) {
      if (error instanceof PinnedVersionChangedError) {
        throw new AssessmentBusyError(error);
      }
      throw error;
    }
  }

  /**
   * The Assessed fields of the version in force for a write, and its number:
   * the PINNED version when the assessment row exists, the timeline's when it
   * does not (DD-3). No version, or a type the timeline does not cover: 409
   * `ASSESSMENT_NO_FIELD_CONFIG`.
   */
  private async assessedOf(
    timeline: WorklistTimeline,
    membership: MembershipRecord,
    held: MembershipRecord['assessment'],
  ): Promise<{ assessed: string[]; core: string[]; version: number }> {
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
    const assessedItems = items.filter(
      (item) =>
        item.resultTypeKey === membership.resultTypeKey &&
        item.visibility === 'assessed',
    );
    return {
      assessed: assessedItems.map((item) => item.fieldKey),
      // The core fields are Assessed fields flagged `isCore` (FR-14), in configuration order.
      core: assessedItems
        .filter((item) => item.isCore)
        .map((item) => item.fieldKey),
      version,
    };
  }

  /**
   * FR-2, FR-11, FR-16, FR-21, NFR-4, NFR-7 (design 7.5, 7.7, DD-8, P-17): add a
   * comment to an Assessed field. The same steps as a validation, in the same
   * lock order, with the comment, its `comment_events` row and the
   * `comment_add` audit row written under the assessment lock.
   *
   * Before the transaction (no lock): the membership in the caller's scope
   * (404), the step judged (403 / 409), an ended assessment refused (409
   * `ASSESSMENT_FINISHED`), the field checked against the Assessed fields of
   * the PINNED version (400 on `fieldKey`), then the value copy: read from THE
   * MEMBERSHIP'S OWN snapshot (`snapshot_sk`), never the latest snapshot of the
   * result, so a comment keeps the value its author saw after a re-sync. The
   * labels are the lists the field names; over 64 KiB the copy is cut and
   * flagged. In the transaction: the timeline `FOR SHARE` (steps re-judged with
   * the same minute), the assessment row (created on the first write) `FOR
   * UPDATE`, the status read under that lock, the comment, its event, the audit
   * row and, for a keyed request, the key mark: they commit together or not at
   * all. The clock is read once.
   */
  async comment(
    user: AuthenticatedUser,
    timelineId: number,
    resultCode: number,
    input: CommentInput,
    requestId: string,
    idempotency?: IdempotencyHandle,
  ): Promise<ViewComment> {
    return await loggedWrite(
      this.logger,
      { action: 'comment', actorId: user.id, requestId, timelineId },
      async (trace) => {
        const at = this.clock();
        return await this.withPinnedRetry(() =>
          this.commentAt(
            at,
            user,
            timelineId,
            resultCode,
            input,
            requestId,
            trace,
            idempotency,
          ),
        );
      },
    );
  }

  private async commentAt(
    at: Date,
    user: AuthenticatedUser,
    timelineId: number,
    resultCode: number,
    input: CommentInput,
    requestId: string,
    trace: WriteLogTrace,
    idempotency?: IdempotencyHandle,
  ): Promise<ViewComment> {
    const now = nowInRome(at);

    const { timeline, access, membership, facts, hasLoad, decision, readStep } =
      await this.resolveWrite(user, timelineId, resultCode, now);
    trace.membershipId = membership.membershipId;
    const stepPosition = decision.stepPosition;
    const held =
      membership.assessment !== null && readStep === stepPosition
        ? membership.assessment
        : null;

    // FR-16: an ended membership or assessment takes no more comments.
    if (membership.ended || (held !== null && held.status !== 'pending')) {
      throw new AssessmentFinishedError();
    }

    const { assessed, version } = await this.assessedOf(
      timeline,
      membership,
      held,
    );
    if (!assessed.includes(input.fieldKey)) {
      throw new AssessmentCommentFieldInvalidError();
    }

    const catalog = await this.catalogOf(membership.cycleYear);
    const snapshot = await this.snapshotOf(membership);
    const { valueCopy, truncated } = buildValueCopy({
      values: snapshot.values,
      labels: snapshot.labels,
      fieldKey: input.fieldKey,
      controlLists:
        catalog.fields.find((field) => field.key === input.fieldKey)
          ?.controlLists ?? [],
    });
    const createdAt = wholeSecond(at);

    const context: WriteContext = {
      timeline,
      access,
      membership,
      facts,
      hasLoad,
      now,
      at,
      stepPosition,
      roleCode: decision.row.role,
      held,
      version,
      user,
    };
    const id = await this.unitOfWork.run(
      async ({ assessments, idempotency: fence }) => {
        const locked = await this.lockForWrite(assessments, context);

        const commentId = await assessments.insertComment({
          assessmentId: locked.id,
          fieldKey: input.fieldKey,
          authorId: user.id,
          stepPosition,
          round: membership.round,
          body: input.body,
          valueCopy,
          valueTruncated: truncated,
          at: createdAt,
        });
        await assessments.insertCommentEvent({
          commentId,
          actorId: user.id,
          actorRole: decision.row.role,
          fromState: null,
          toState: 'open',
          at,
        });
        await assessments.insertAudit({
          assessmentId: locked.id,
          actorId: user.id,
          action: 'comment_add',
          fieldKeys: [input.fieldKey],
          commentId,
          requestId,
          at,
        });
        // The exactly-once fence (P-17): `in_progress` to `executed`, in this transaction.
        if (idempotency !== undefined) {
          await fence.markExecuted(idempotency.reservation, commentId);
        }
        return commentId;
      },
    );

    return toViewComment({
      id,
      fieldKey: input.fieldKey,
      authorId: user.id,
      authorNickname: user.nickname,
      body: input.body,
      state: 'open',
      stepPosition,
      round: membership.round,
      valueCopy,
      valueTruncated: truncated,
      createdAt,
      withdrawnAt: null,
    });
  }

  /**
   * FR-13, FR-19, FR-21, OQ-8 (design 7.7): the author withdraws their own
   * comment while it is `open` (the program has not answered) and step 1 or
   * step 2 of the timeline is open. A withdraw after the END is allowed: it
   * never refuses an ended assessment and never changes its status.
   *
   * Before the transaction: the comment with its assessment and membership,
   * the caller's scope on that membership (a comment that is missing and one
   * outside the scope are one and the same 404), the author (403
   * `ASSESSMENT_NOT_COMMENT_AUTHOR`, only after the scope, so it tells nothing
   * to a stranger), the state (409 `ASSESSMENT_COMMENT_NOT_OPEN`) and the window
   * (409 `ASSESSMENT_STEP_CLOSED`). In the transaction, in the lock order of
   * design 5: the timeline `FOR SHARE` (window re-judged with the same minute),
   * the assessment row `FOR UPDATE` (so a finish counting the non-withdrawn
   * comments waits for this one), then ONE conditional UPDATE that matches only
   * while the comment is `open`, so a second withdraw or a program answer that
   * committed in between is decided by the database (409), then the
   * `comment_events` row and the `comment_withdraw` audit row. The clock is read
   * once.
   */
  async withdraw(
    user: AuthenticatedUser,
    commentId: number,
    requestId: string,
  ): Promise<ViewComment> {
    return await loggedWrite(
      this.logger,
      { action: 'withdraw', actorId: user.id, requestId },
      (trace) => this.withdrawAt(user, commentId, requestId, trace),
    );
  }

  private async withdrawAt(
    user: AuthenticatedUser,
    commentId: number,
    requestId: string,
    trace: WriteLogTrace,
  ): Promise<ViewComment> {
    const at = this.clock();
    const now = nowInRome(at);

    const context = await this.store.findCommentContext(commentId);
    if (context === null) throw new AssessmentNotFoundError();
    const [timeline] = await this.worklist.findTimelines(
      user.id,
      context.timelineId,
    );
    if (timeline === undefined) throw new AssessmentNotFoundError();
    const admin = this.authorization.can(user, Permission.ADMIN_ACCESS);
    const access = resolveAccess(user, timeline.roleCodes, admin);
    if (!admin && access.reviewerRows.length === 0) {
      throw new AssessmentNotFoundError();
    }
    const membership = await this.store.findMembership({
      timelineId: timeline.id,
      resultCode: context.resultCode,
      access,
      round: context.round,
      assessmentStepPosition: context.stepPosition,
    });
    // The membership of THIS comment, inside the caller's scope: any other is "not found".
    if (
      membership === null ||
      membership.membershipId !== context.timelineResultId
    ) {
      throw new AssessmentNotFoundError();
    }
    // Ids only, and only once the comment is inside the caller's scope.
    trace.timelineId = timeline.id;
    trace.membershipId = membership.membershipId;

    if (context.authorId !== user.id) {
      throw new AssessmentNotCommentAuthorError();
    }
    if (context.state !== 'open') throw new AssessmentCommentNotOpenError();
    const hasLoad = (await this.loads.withLoad([timeline.id])).has(timeline.id);
    if (!isWithdrawWindowOpen({ steps: timeline.steps, now, hasLoad })) {
      throw new AssessmentStepClosedError();
    }

    const actorRole = access.reviewerRows[0]?.role ?? 'ADMIN';
    const withdrawnAt = wholeSecond(at);
    await this.unitOfWork.run(async ({ assessments }) => {
      const steps = await assessments.lockTimelineShared(timeline.id);
      if (steps === null) throw new AssessmentNotFoundError();
      if (!isWithdrawWindowOpen({ steps, now, hasLoad })) {
        throw new AssessmentStepClosedError();
      }
      const locked = await assessments.lockAssessment(
        context.timelineResultId,
        context.stepPosition,
      );
      if (locked === undefined) throw new Error('assessment_row_missing');
      // No `status` check on purpose (OQ-8): withdrawing after the end is allowed.
      if (!(await assessments.withdrawComment(commentId, withdrawnAt))) {
        throw new AssessmentCommentNotOpenError();
      }
      await assessments.insertCommentEvent({
        commentId,
        actorId: user.id,
        actorRole,
        fromState: 'open',
        toState: 'withdrawn',
        at,
      });
      await assessments.insertAudit({
        assessmentId: context.assessmentId,
        actorId: user.id,
        action: 'comment_withdraw',
        fieldKeys: [context.fieldKey],
        commentId,
        requestId,
        at,
      });
    });

    return toViewComment({ ...context, state: 'withdrawn', withdrawnAt });
  }

  /**
   * The answer of a comment create as recorded (P-17), for the idempotency
   * replay reader: the comment read back by id, with no scope check (the key
   * belongs to the caller who made it). The comment and the key mark commit
   * together, so a missing row is a bug: it throws, and the interceptor
   * answers 503. One read, no lock, no write.
   */
  async replayComment(commentId: number): Promise<ViewComment> {
    const context = await this.store.findCommentContext(commentId);
    if (context === null) {
      throw new Error(`Comment ${commentId} has no comment row`);
    }
    return toViewComment(context);
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
