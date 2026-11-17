// P2-3911: the writes of a program response and of an assessor's
// clarification answer, in ONE transaction each, in the assessment module's
// lock order: timeline FOR SHARE → assessment FOR UPDATE → the comment and the
// rows under it.
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../../database/drizzle/drizzle.constants.js';
import type { DrizzleDB } from '../../database/drizzle/drizzle.module.js';
import {
  assessmentComments,
  type CommentState,
} from '../../database/drizzle/schema/assessment-comments.js';
import { commentClarificationAnswers } from '../../database/drizzle/schema/comment-clarification-answers.js';
import {
  spCommentResponses,
  type SpResponseKind,
} from '../../database/drizzle/schema/sp-comment-responses.js';
import {
  DrizzleAssessmentWriteStore,
  type AssessmentWriteStore,
} from '../assessment.store.js';
import { DEADLOCK_ATTEMPTS, isDeadlock } from '../assessment.unit-of-work.js';

export const SP_RESPONSE_UNIT_OF_WORK = Symbol('SP_RESPONSE_UNIT_OF_WORK');

export interface NewSpResponseRow {
  commentId: number;
  kind: SpResponseKind;
  body: string | null;
  responderName: string;
  responderEmail: string;
  programId: number;
  at: Date;
}

export interface NewClarificationAnswerRow {
  commentId: number;
  responseId: number;
  authorId: number;
  body: string;
  at: Date;
}

/** The SP statements of one transaction. */
export interface SpWriteStore {
  /**
   * One conditional statement: `UPDATE … SET state = to WHERE id = ? AND
   * state = from`. `false` when it matched nothing: another write changed the
   * comment first, and the database decides the race. (mysql2 connects with
   * FOUND_ROWS, so a row whose state is already `to` still counts as matched.)
   */
  setCommentState(
    commentId: number,
    from: CommentState,
    to: CommentState,
  ): Promise<boolean>;
  /** One statement. Returns the new response id. */
  insertResponse(row: NewSpResponseRow): Promise<number>;
  /** One statement: the id of the latest response of the comment if it is a clarification request, else null. */
  findPendingClarificationRequest(commentId: number): Promise<number | null>;
  /** One statement. Returns the new answer id. */
  insertClarificationAnswer(row: NewClarificationAnswerRow): Promise<number>;
}

export interface SpRepositories {
  /** The assessment write port on THIS transaction (the locks and the comment event). */
  assessments: AssessmentWriteStore;
  sp: SpWriteStore;
}

export interface SpResponseUnitOfWork {
  run<T>(work: (repositories: SpRepositories) => Promise<T>): Promise<T>;
}

type SpWriteDb = Pick<DrizzleDB, 'select' | 'insert' | 'update'>;

export class DrizzleSpWriteStore implements SpWriteStore {
  constructor(private readonly db: SpWriteDb) {}

  buildSetCommentState(
    commentId: number,
    from: CommentState,
    to: CommentState,
  ) {
    return this.db
      .update(assessmentComments)
      .set({ state: to })
      .where(
        and(
          eq(assessmentComments.id, commentId),
          eq(assessmentComments.state, from),
        ),
      );
  }

  async setCommentState(
    commentId: number,
    from: CommentState,
    to: CommentState,
  ): Promise<boolean> {
    const [header] = await this.buildSetCommentState(commentId, from, to);
    return header.affectedRows > 0;
  }

  buildInsertResponse(row: NewSpResponseRow) {
    return this.db.insert(spCommentResponses).values({
      commentId: row.commentId,
      kind: row.kind,
      body: row.body,
      responderName: row.responderName,
      responderEmail: row.responderEmail,
      programId: row.programId,
      createdAt: row.at,
    });
  }

  async insertResponse(row: NewSpResponseRow): Promise<number> {
    const [header] = await this.buildInsertResponse(row);
    return header.insertId;
  }

  buildLatestResponse(commentId: number) {
    return this.db
      .select({ id: spCommentResponses.id, kind: spCommentResponses.kind })
      .from(spCommentResponses)
      .where(eq(spCommentResponses.commentId, commentId))
      .orderBy(desc(spCommentResponses.id))
      .limit(1);
  }

  async findPendingClarificationRequest(
    commentId: number,
  ): Promise<number | null> {
    const [latest] = await this.buildLatestResponse(commentId);
    return latest?.kind === 'request_clarification' ? latest.id : null;
  }

  buildInsertClarificationAnswer(row: NewClarificationAnswerRow) {
    return this.db.insert(commentClarificationAnswers).values({
      commentId: row.commentId,
      responseId: row.responseId,
      authorId: row.authorId,
      body: row.body,
      createdAt: row.at,
    });
  }

  async insertClarificationAnswer(
    row: NewClarificationAnswerRow,
  ): Promise<number> {
    const [header] = await this.buildInsertClarificationAnswer(row);
    return header.insertId;
  }
}

/**
 * One READ COMMITTED transaction per SP write, like
 * `DrizzleAssessmentUnitOfWork`; a deadlock (1213) reruns the whole work, at
 * most `DEADLOCK_ATTEMPTS` times.
 */
@Injectable()
export class DrizzleSpResponseUnitOfWork implements SpResponseUnitOfWork {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async run<T>(work: (repositories: SpRepositories) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.db.transaction(
          (tx) =>
            work({
              assessments: new DrizzleAssessmentWriteStore(tx),
              sp: new DrizzleSpWriteStore(tx),
            }),
          { isolationLevel: 'read committed' },
        );
      } catch (error) {
        if (attempt >= DEADLOCK_ATTEMPTS || !isDeadlock(error)) throw error;
      }
    }
  }
}
