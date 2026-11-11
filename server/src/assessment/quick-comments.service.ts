// @akili-spec assessment/step-1-assessment
import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  ADMIN_CONFIG_CLOCK,
  type AdminConfigClock,
} from '../admin-config/admin-config.clock.js';
import { isLiveAssignment } from '../users/current-user.cache.js';
import type { AuthenticatedUser } from '../users/current-user.cache.js';
import { AssessmentQuickCommentsForbiddenError } from './assessment.errors.js';
import {
  ASSESSMENT_STORE,
  type AssessmentStore,
  type QuickCommentRecord,
} from './assessment.store.js';
import {
  ASSESSMENT_UNIT_OF_WORK,
  type AssessmentUnitOfWork,
} from './assessment.unit-of-work.js';
import { ROLE_STEPS } from './role-steps.js';

/** The roles that write assessment comments: the ones that can hold quick comments (design 7.1). */
export const QUICK_COMMENT_ROLES: readonly string[] = ROLE_STEPS.filter(
  (row) => row.access === 'write',
).map((row) => row.role);

/** A quick comment as the routes answer it (design 6). */
export interface QuickCommentView {
  id: number;
  body: string;
  createdAt: string;
}

/** The answer of a save: the row, and whether this call made it (201) or it already existed (200). */
export interface QuickCommentSaved {
  comment: QuickCommentView;
  created: boolean;
}

const toView = (row: QuickCommentRecord): QuickCommentView => ({
  id: row.id,
  body: row.body,
  createdAt: row.createdAt.toISOString(),
});

/** A datetime column keeps whole seconds, so a stamp is cut to them: what an answer says is then what a re-read gives. */
const wholeSecond = (at: Date): Date =>
  new Date(Math.floor(at.getTime() / 1000) * 1000);

/**
 * Quick comments, shared by role (FR-12, FR-21; design 6, 7.7). Every user
 * with a live grant of the role reads and saves the role's list; a user of
 * another role is refused (403), so a TPB user never sees the ASSESSOR list.
 * No assessment is involved: the list belongs to the role.
 */
@Injectable()
export class QuickCommentsService {
  constructor(
    @Inject(ASSESSMENT_STORE) private readonly store: AssessmentStore,
    @Inject(ASSESSMENT_UNIT_OF_WORK)
    private readonly unitOfWork: AssessmentUnitOfWork,
    @Inject(ADMIN_CONFIG_CLOCK) private readonly clock: AdminConfigClock,
  ) {}

  /** The role's quick comments, newest first. One statement. */
  async list(user: AuthenticatedUser, role: string): Promise<QuickCommentView[]> {
    this.assertGrant(user, role);
    return (await this.store.listQuickComments(role)).map(toView);
  }

  /**
   * Saves a text for the role. The body is trimmed again here, and its sha-256
   * is the key with the role: a text that is already saved answers the
   * existing row with `created: false` and writes no audit row (a no-op
   * writes none, FR-21). A new text writes its row and its `quick_comment_save`
   * audit row in one transaction. The audit row never holds the text. The clock
   * is read once.
   */
  async save(
    user: AuthenticatedUser,
    role: string,
    body: string,
    requestId: string,
  ): Promise<QuickCommentSaved> {
    this.assertGrant(user, role);
    const at = this.clock();
    const text = body.trim();
    const saved = await this.unitOfWork.run(async ({ assessments }) => {
      const row = await assessments.saveQuickComment({
        roleCode: role,
        body: text,
        bodyHash: createHash('sha256').update(text).digest('hex'),
        createdBy: user.id,
        at: wholeSecond(at),
      });
      if (row.created) {
        await assessments.insertAudit({
          assessmentId: null,
          actorId: user.id,
          action: 'quick_comment_save',
          fieldKeys: null,
          commentId: null,
          requestId,
          at,
        });
      }
      return row;
    });
    return { comment: toView(saved), created: saved.created };
  }

  /** A live grant of the role itself (not ADMIN's every permission, P-35), and a role that writes comments. */
  private assertGrant(user: AuthenticatedUser, role: string): void {
    if (
      !QUICK_COMMENT_ROLES.includes(role) ||
      !user.assignments.some(
        (assignment) =>
          assignment.roleCode === role && isLiveAssignment(assignment),
      )
    ) {
      throw new AssessmentQuickCommentsForbiddenError();
    }
  }
}
