// P2-3911: the writes of the Science Program view (a program response to a
// QA comment) and of the assessor side (the answer to a clarification the
// program requested), and the assessor's read of the program threads.
//
// A response changes the COMMENT only: it never touches validations, the
// assessment status, a release or the membership. Accepting never validates a
// field and never makes a result Quality Assessed.
import { Inject, Injectable } from '@nestjs/common';
import {
  ADMIN_CONFIG_CLOCK,
  type AdminConfigClock,
} from '../../admin-config/admin-config.clock.js';
import { nowInRome } from '../../admin-config/rome-date.js';
import {
  TIMELINE_LOADS,
  type TimelineLoads,
} from '../../admin-config/timelines/timeline-loads.js';
import type { CommentState } from '../../database/drizzle/schema/assessment-comments.js';
import type { SpResponseKind } from '../../database/drizzle/schema/sp-comment-responses.js';
import { AuthorizationService } from '../../users/authorization.service.js';
import type { AuthenticatedUser } from '../../users/current-user.cache.js';
import { Permission } from '../../users/permissions.js';
import { AssessmentService } from '../assessment.service.js';
import {
  AssessmentNotCommentAuthorError,
  AssessmentNotFoundError,
  AssessmentReadOnlyError,
  AssessmentStepClosedError,
} from '../assessment.errors.js';
import { ASSESSMENT_STORE, type AssessmentStore } from '../assessment.store.js';
import {
  isTransitionAllowed,
  PROGRAM_FROM_STATES,
} from '../comment-transitions.js';
import { audienceStepState } from '../role-steps.js';
import { resolveAccess } from '../scope.js';
import { WORKLIST_STORE, type WorklistStore } from '../worklist.store.js';
import type { SpSessionPrincipal } from './sp-access.store.js';
import {
  SP_RESPONSE_UNIT_OF_WORK,
  type SpResponseUnitOfWork,
} from './sp-response.unit-of-work.js';
import { logSpResponse, withSpLog } from './sp-log.js';
import {
  commentsVisibleIn,
  countsOf,
  toAssessorThreads,
  toSpComments,
  type AssessorThreadView,
  type SpCommentView,
  type SpCounts,
} from './sp-thread.js';
import {
  ClarificationNotPendingError,
  SpCommentNotRespondableError,
  SpNotFoundError,
  SpStepClosedError,
} from './sp-view.errors.js';
import { STATE_OF_KIND } from './sp-state.js';
import { SpViewService } from './sp-view.service.js';
import {
  SP_VIEW_STORE,
  type SpResponseRecord,
  type SpViewStore,
} from './sp-view.store.js';

export interface SpRespondInput {
  kind: SpResponseKind;
  body?: string | null;
}

export interface SpRespondAnswer {
  comment: SpCommentView;
  counts: SpCounts;
}

@Injectable()
export class SpResponseService {
  constructor(
    @Inject(SP_VIEW_STORE) private readonly store: SpViewStore,
    @Inject(SpViewService) private readonly view: SpViewService,
    @Inject(SP_RESPONSE_UNIT_OF_WORK)
    private readonly unitOfWork: SpResponseUnitOfWork,
    @Inject(ASSESSMENT_STORE) private readonly assessments: AssessmentStore,
    @Inject(WORKLIST_STORE) private readonly worklist: WorklistStore,
    @Inject(TIMELINE_LOADS) private readonly loads: TimelineLoads,
    @Inject(AuthorizationService)
    private readonly authorization: AuthorizationService,
    @Inject(AssessmentService) private readonly assessment: AssessmentService,
    @Inject(ADMIN_CONFIG_CLOCK) private readonly clock: AdminConfigClock,
  ) {}

  /**
   * A program responds to a QA comment (or changes its response). Checks, in
   * order: the comment exists, is visible to the program and is in the
   * session's scope (else 404 `SP_NOT_FOUND`, the body of "does not exist");
   * the programs step is in progress (409 `SP_STEP_CLOSED`); the state accepts
   * a response (409 `SP_COMMENT_NOT_RESPONDABLE`). Then one transaction in the
   * module's lock order: the timeline FOR SHARE (step re-judged with the same
   * minute), the assessment FOR UPDATE, the conditional state UPDATE (0 rows:
   * someone else changed it, 409), the response row, the comment event (no QA
   * actor, role PROGRAM, the response id). The clock is read once.
   */
  respond(
    session: SpSessionPrincipal,
    commentId: number,
    input: SpRespondInput,
    requestId: string,
  ): Promise<SpRespondAnswer> {
    return withSpLog(
      (outcome, reason) =>
        logSpResponse({
          action: 'respond',
          commentId,
          kind: input.kind,
          outcome,
          reason,
          sessionId: session.id,
          requestId,
        }),
      () => this.respondAt(this.clock(), session, commentId, input),
    );
  }

  private async respondAt(
    at: Date,
    session: SpSessionPrincipal,
    commentId: number,
    input: SpRespondInput,
  ): Promise<SpRespondAnswer> {
    const now = nowInRome(at);
    const scope = await this.store.findCommentScope(commentId);
    if (
      scope === null ||
      !scope.visible ||
      scope.deleted ||
      scope.state === 'withdrawn' ||
      (!session.isReportingAdmin && scope.programId !== session.programId)
    ) {
      throw new SpNotFoundError();
    }
    const context = await this.view.timelineFor(
      scope.programId,
      scope.timelineId,
      at,
    );
    // The comment must be one the SP view shows: of the assessors' step of a
    // listed round-1 membership, while the programs step has started.
    if (
      scope.stepPosition !== context.assessmentStepPosition ||
      !commentsVisibleIn(context.stepState)
    ) {
      throw new SpNotFoundError();
    }
    const membership = await this.view.membershipFor(
      scope.programId,
      context,
      scope.resultCode,
    );
    if (membership.membershipId !== scope.membershipId) {
      throw new SpNotFoundError();
    }
    if (context.stepState !== 'in_progress') throw new SpStepClosedError();
    const to = STATE_OF_KIND[input.kind];
    if (
      !PROGRAM_FROM_STATES.includes(scope.state) ||
      !isTransitionAllowed(scope.state, to, 'program')
    ) {
      throw new SpCommentNotRespondableError();
    }
    const hasLoad = (await this.loads.withLoad([scope.timelineId])).has(
      scope.timelineId,
    );
    const body = input.kind === 'accept' ? null : (input.body ?? null);

    // A retry of the same answer (same kind and text as the latest response,
    // comment already in its state) writes nothing: the SP page sends no
    // Idempotency-Key, so a timeout and a second try must not grow the history.
    if (scope.state === to) {
      const latest = (await this.store.findResponses([commentId])).reduce<
        SpResponseRecord | undefined
      >(
        (last, r) => (last === undefined || r.id > last.id ? r : last),
        undefined,
      );
      if (
        latest !== undefined &&
        latest.kind === input.kind &&
        latest.body === body
      ) {
        return this.answerFor(scope.assessmentId, commentId);
      }
    }

    await this.unitOfWork.run(async ({ assessments, sp }) => {
      const steps = await assessments.lockTimelineShared(scope.timelineId);
      if (steps === null) throw new SpNotFoundError();
      if (
        audienceStepState('programs', { steps, now, hasLoad }) !== 'in_progress'
      ) {
        throw new SpStepClosedError();
      }
      const locked = await assessments.lockAssessment(
        scope.membershipId,
        scope.stepPosition,
      );
      if (locked === undefined) throw new Error('assessment_row_missing');
      if (!(await sp.setCommentState(commentId, scope.state, to))) {
        throw new SpCommentNotRespondableError();
      }
      const responseId = await sp.insertResponse({
        commentId,
        kind: input.kind,
        body,
        responderName: session.name,
        responderEmail: session.email,
        programId: scope.programId,
        at,
      });
      await assessments.insertCommentEvent({
        commentId,
        actorId: null,
        actorRole: 'PROGRAM',
        fromState: scope.state,
        toState: to,
        spResponseId: responseId,
        at,
      });
    });

    return this.answerFor(scope.assessmentId, commentId);
  }

  /** The answered comment with its thread, and the counts of the result. */
  private async answerFor(
    assessmentId: number,
    commentId: number,
  ): Promise<SpRespondAnswer> {
    const comments = await this.store.findVisibleComments(assessmentId);
    const ids = comments.map((x) => x.id);
    const [responses, answers] = await Promise.all([
      this.store.findResponses(ids),
      this.store.findClarificationAnswers(ids),
    ]);
    const views = toSpComments(comments, responses, answers);
    const comment = views.find((x) => x.id === commentId);
    if (comment === undefined) throw new SpNotFoundError();
    return { comment, counts: countsOf(views) };
  }

  /**
   * The author answers the clarification the program requested; the comment
   * goes back to `open`, so the program can respond again. Scope as a
   * withdraw: a comment outside the caller's reviewer rows is the same 404
   * `ASSESSMENT_NOT_FOUND` as a missing one; an ADMIN with no reviewer row is
   * read only (403); only the author answers (403); only while the programs
   * step is in progress (409 `ASSESSMENT_STEP_CLOSED`) and a request is
   * pending (409 `CLARIFICATION_NOT_PENDING`). One transaction in the module's
   * lock order.
   */
  answerClarification(
    user: AuthenticatedUser,
    commentId: number,
    body: string,
    requestId: string,
  ): Promise<AssessorThreadView> {
    return withSpLog(
      (outcome, reason) =>
        logSpResponse({
          action: 'clarification_answer',
          commentId,
          outcome,
          reason,
          actorId: user.id,
          requestId,
        }),
      () => this.answerAt(this.clock(), user, commentId, body),
    );
  }

  private async answerAt(
    at: Date,
    user: AuthenticatedUser,
    commentId: number,
    body: string,
  ): Promise<AssessorThreadView> {
    const now = nowInRome(at);
    const context = await this.assessments.findCommentContext(commentId);
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
    const membership = await this.assessments.findMembership({
      timelineId: timeline.id,
      resultCode: context.resultCode,
      access,
      round: context.round,
      // Round 1 only: the program never reads a round-2 step (round-2 FR-15).
      roundTwoStepPositions: [],
      assessmentStepPosition: context.stepPosition,
    });
    if (
      membership === null ||
      membership.membershipId !== context.timelineResultId
    ) {
      throw new AssessmentNotFoundError();
    }
    if (access.reviewerRows.length === 0) throw new AssessmentReadOnlyError();
    if (context.authorId !== user.id) {
      throw new AssessmentNotCommentAuthorError();
    }
    const hasLoad = (await this.loads.withLoad([timeline.id])).has(timeline.id);
    if (
      audienceStepState('programs', { steps: timeline.steps, now, hasLoad }) !==
      'in_progress'
    ) {
      throw new AssessmentStepClosedError();
    }
    if (context.state !== 'clarification_requested') {
      throw new ClarificationNotPendingError();
    }
    const actorRole = access.reviewerRows[0]?.role ?? 'ASSESSOR';

    await this.unitOfWork.run(async ({ assessments, sp }) => {
      const steps = await assessments.lockTimelineShared(timeline.id);
      if (steps === null) throw new AssessmentNotFoundError();
      if (
        audienceStepState('programs', { steps, now, hasLoad }) !== 'in_progress'
      ) {
        throw new AssessmentStepClosedError();
      }
      const locked = await assessments.lockAssessment(
        context.timelineResultId,
        context.stepPosition,
      );
      if (locked === undefined) throw new Error('assessment_row_missing');
      if (
        !(await sp.setCommentState(
          commentId,
          'clarification_requested',
          'open',
        ))
      ) {
        throw new ClarificationNotPendingError();
      }
      const requestIdOfClarification =
        await sp.findPendingClarificationRequest(commentId);
      if (requestIdOfClarification === null) {
        throw new ClarificationNotPendingError();
      }
      await sp.insertClarificationAnswer({
        commentId,
        responseId: requestIdOfClarification,
        authorId: user.id,
        body,
        at,
      });
      await assessments.insertCommentEvent({
        commentId,
        actorId: user.id,
        actorRole,
        fromState: 'clarification_requested',
        toState: 'open',
        at,
      });
    });

    const [thread] = await this.threadsOf([
      { id: commentId, fieldKey: context.fieldKey, state: 'open' },
    ]);
    return thread!;
  }

  /**
   * The program threads of a result, for the assessor (and later the Lead
   * Assessor): the same scope and 404 as the assessment view, every comment
   * visible to the program, with the responder's name and email.
   */
  async threadsFor(
    user: AuthenticatedUser,
    timelineId: number,
    resultCode: number,
  ): Promise<{ comments: AssessorThreadView[] }> {
    const { timeline, access, membership } = await this.assessment.resolveForAi(
      user,
      timelineId,
      resultCode,
    );
    if (membership.assessment === null) return { comments: [] };
    const comments = await this.store.findVisibleComments(
      membership.assessment.id,
    );
    // The same checks as `answerClarification`, so the form shows only when the POST would pass.
    const hasLoad = (await this.loads.withLoad([timeline.id])).has(timeline.id);
    const programsOpen =
      audienceStepState('programs', {
        steps: timeline.steps,
        now: nowInRome(this.clock()),
        hasLoad,
      }) === 'in_progress';
    const canWrite = access.reviewerRows.length > 0;
    const pending = comments.filter(
      (x) => x.state === 'clarification_requested',
    );
    const authorOf = new Map(
      canWrite && programsOpen && pending.length > 0
        ? (await this.store.findCommentAuthors(pending.map((x) => x.id))).map(
            (x) => [x.id, x.authorId] as const,
          )
        : [],
    );
    return {
      comments: await this.threadsOf(
        comments,
        (comment) =>
          canWrite &&
          programsOpen &&
          comment.state === 'clarification_requested' &&
          authorOf.get(comment.id) === user.id,
      ),
    };
  }

  private async threadsOf(
    comments: ReadonlyArray<{
      id: number;
      fieldKey: string;
      state: CommentState;
    }>,
    answerable?: (comment: { id: number; state: CommentState }) => boolean,
  ): Promise<AssessorThreadView[]> {
    const ids = comments.map((x) => x.id);
    const [responses, answers] = await Promise.all([
      this.store.findResponses(ids),
      this.store.findClarificationAnswers(ids),
    ]);
    return toAssessorThreads(comments, responses, answers, answerable);
  }
}
