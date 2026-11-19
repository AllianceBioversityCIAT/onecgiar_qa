// P2-3911: in-memory fakes of the SP view stores, same contract as the Drizzle
// adapters (only hashes stored; the code is spent by a conditional update).
import type {
  NewSpCode,
  NewSpSession,
  SpAccessStore,
  SpSessionPrincipal,
} from '../../src/assessment/sp-view/sp-access.store.js';

import type {
  ClarificationAnswerRecord,
  SpCommentRecord,
  SpCommentScope,
  SpResponseRecord,
  SpResultRecord,
  SpResultsCriteria,
  SpTimelineRecord,
  SpViewStore,
} from '../../src/assessment/sp-view/sp-view.store.js';
import {
  InMemoryAssessmentWriteStore,
  type FakeComment,
  type InMemoryAssessmentWorld,
} from './in-memory-assessment.js';
import type { CommentState } from '../../src/database/drizzle/schema/assessment-comments.js';
import type {
  NewClarificationAnswerRow,
  NewSpResponseRow,
  SpRepositories,
  SpResponseUnitOfWork,
  SpWriteStore,
} from '../../src/assessment/sp-view/sp-response.unit-of-work.js';

export interface FakeSpCodeRow extends NewSpCode {
  id: number;
  usedAt: Date | null;
}

export interface FakeSpSessionRow extends NewSpSession {
  id: number;
  email: string;
  name: string;
  programId: number | null;
  isReportingAdmin: boolean;
}

export class InMemorySpAccessStore implements SpAccessStore {
  codes: FakeSpCodeRow[] = [];
  sessions: FakeSpSessionRow[] = [];
  /** Lookups of a session, to prove a guard refused before reading. */
  lookups = 0;

  insertCode(code: NewSpCode): Promise<void> {
    if (this.codes.some((c) => c.codeHash === code.codeHash)) {
      return Promise.reject(new Error('duplicate code_hash'));
    }
    this.codes.push({ ...code, id: this.codes.length + 1, usedAt: null });
    return Promise.resolve();
  }

  exchangeCode(
    codeHash: string,
    now: Date,
    session: NewSpSession,
  ): Promise<SpSessionPrincipal | null> {
    // The conditional UPDATE: unused, not expired, this hash.
    const row = this.codes.find(
      (c) =>
        c.codeHash === codeHash &&
        c.usedAt === null &&
        c.expiresAt.getTime() >= now.getTime(),
    );
    if (row === undefined) return Promise.resolve(null);
    row.usedAt = now;
    const inserted: FakeSpSessionRow = {
      ...session,
      id: this.sessions.length + 1,
      email: row.email,
      name: row.name,
      programId: row.programId,
      isReportingAdmin: row.isReportingAdmin,
    };
    this.sessions.push(inserted);
    return Promise.resolve(principalOf(inserted));
  }

  findLiveSession(
    tokenHash: string,
    now: Date,
  ): Promise<SpSessionPrincipal | null> {
    this.lookups++;
    const row = this.sessions.find(
      (s) => s.tokenHash === tokenHash && s.expiresAt.getTime() > now.getTime(),
    );
    return Promise.resolve(row === undefined ? null : principalOf(row));
  }
}

const principalOf = (s: FakeSpSessionRow): SpSessionPrincipal => ({
  id: s.id,
  email: s.email,
  name: s.name,
  programId: s.programId,
  isReportingAdmin: s.isReportingAdmin,
});

// ---- SP view reads over the assessment world (P2-3911) ----------------------

const ANSWERED = ['accepted', 'accepted_with_comment', 'disagreed'];

/** The id a fake comment answers to (the world's rule: `id`, else its index + 1). */
export const commentIdOf = (world: InMemoryAssessmentWorld, c: FakeComment) =>
  c.id ?? world.comments.indexOf(c) + 1;

/**
 * `SpViewStore` over the assessment world, with the Drizzle adapter's
 * semantics; each call is one counted statement (none for an empty id list).
 */
export class InMemorySpViewStore implements SpViewStore {
  constructor(private readonly world: InMemoryAssessmentWorld) {}

  findTimelines(
    programId: number,
    timelineId?: number,
  ): Promise<SpTimelineRecord[]> {
    this.world.statements += 1;
    return Promise.resolve(
      this.world.timelines
        .filter((t) => (t.cycleStatus ?? 'active') === 'active')
        .filter((t) => timelineId === undefined || t.id === timelineId)
        .filter(
          (t) =>
            t.kind === 'official' ||
            (t.allPrograms ?? true) ||
            (t.programIds ?? []).includes(programId),
        )
        .sort((x, y) => x.id - y.id)
        .map((t) => ({
          id: t.id,
          cycleId: t.cycleId ?? 1,
          name: t.name,
          kind: t.kind,
          steps: [...t.steps].sort((x, y) => x.position - y.position),
        })),
    );
  }

  listResults(criteria: SpResultsCriteria): Promise<SpResultRecord[]> {
    this.world.statements += 1;
    const out: SpResultRecord[] = [];
    for (const m of [...this.world.memberships].sort(
      (x, y) => x.resultCode - y.resultCode || x.id - y.id,
    )) {
      if (
        m.timelineId !== criteria.timelineId ||
        m.programId !== criteria.programId ||
        (m.round ?? 1) !== 1 ||
        (m.status ?? 'pending') === 'not_in_qa'
      ) {
        continue;
      }
      const ended = m.ended ?? false;
      const endReason = m.endReason ?? null;
      if (ended && endReason !== 'released_qaed' && endReason !== 'returned') {
        continue;
      }
      const assessment = this.world.assessments.find(
        (a) =>
          a.membershipId === m.id &&
          criteria.assessmentStepPosition !== null &&
          a.stepPosition === criteria.assessmentStepPosition,
      );
      const own =
        assessment === undefined
          ? []
          : this.world.comments.filter((c) => c.assessmentId === assessment.id);
      const visible = own.filter(
        (c) =>
          (c.visibleToProgramAt ?? null) !== null &&
          c.state !== 'withdrawn' &&
          (c.deletedAt ?? null) === null,
      );
      out.push({
        membershipId: m.id,
        resultCode: m.resultCode,
        title: m.title,
        resultTypeKey: m.resultTypeKey,
        membershipStatus: m.status ?? 'pending',
        endReason,
        assessmentStatus: assessment?.status ?? null,
        hasClarificationThread: own.some(
          (c) => c.state === 'clarification_requested',
        ),
        updated: this.world.memberships.some(
          (r) =>
            r.timelineId === m.timelineId &&
            r.resultCode === m.resultCode &&
            (r.round ?? 1) === 2 &&
            (r.changedFields?.length ?? 0) > 0,
        ),
        comments: criteria.commentsVisible ? visible.length : 0,
        answered: criteria.commentsVisible
          ? visible.filter((c) => ANSWERED.includes(c.state)).length
          : 0,
      });
    }
    return Promise.resolve(out);
  }

  findVisibleComments(assessmentId: number): Promise<SpCommentRecord[]> {
    this.world.statements += 1;
    return Promise.resolve(
      this.world.comments
        .filter(
          (c) =>
            c.assessmentId === assessmentId &&
            (c.visibleToProgramAt ?? null) !== null &&
            c.state !== 'withdrawn' &&
            (c.deletedAt ?? null) === null,
        )
        .map((c) => ({
          id: commentIdOf(this.world, c),
          fieldKey: c.fieldKey ?? 'general.title',
          body: c.body ?? 'A comment',
          state: c.state,
          valueCopy: c.valueCopy ?? { value: null },
          valueTruncated: c.valueTruncated ?? false,
          createdAt: c.createdAt ?? new Date('2026-03-10T09:00:00.000Z'),
        }))
        .sort(
          (x, y) =>
            x.createdAt.getTime() - y.createdAt.getTime() || x.id - y.id,
        ),
    );
  }

  findResponses(commentIds: readonly number[]): Promise<SpResponseRecord[]> {
    if (commentIds.length === 0) return Promise.resolve([]);
    this.world.statements += 1;
    return Promise.resolve(
      this.world.spResponses
        .filter((r) => commentIds.includes(r.commentId))
        .sort((x, y) => x.commentId - y.commentId || x.id - y.id)
        .map((r) => ({ ...r })),
    );
  }

  findClarificationAnswers(
    commentIds: readonly number[],
  ): Promise<ClarificationAnswerRecord[]> {
    if (commentIds.length === 0) return Promise.resolve([]);
    this.world.statements += 1;
    return Promise.resolve(
      this.world.clarificationAnswers
        .filter((x) => commentIds.includes(x.commentId))
        .sort((x, y) => x.id - y.id)
        .map(({ id, commentId, responseId, body, createdAt }) => ({
          id,
          commentId,
          responseId,
          body,
          createdAt,
        })),
    );
  }

  findCommentScope(commentId: number): Promise<SpCommentScope | null> {
    this.world.statements += 1;
    const comment = this.world.comments.find(
      (c) => commentIdOf(this.world, c) === commentId,
    );
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
      commentId,
      state: comment.state,
      authorId: comment.authorId,
      fieldKey: comment.fieldKey ?? 'general.title',
      visible: (comment.visibleToProgramAt ?? null) !== null,
      deleted: (comment.deletedAt ?? null) !== null,
      assessmentId: assessment.id,
      stepPosition: assessment.stepPosition,
      membershipId: membership.id,
      timelineId: membership.timelineId,
      resultCode: membership.resultCode,
      programId: membership.programId,
      round: membership.round ?? 1,
    });
  }
}

// ---- SP writes over the assessment world (P2-3911) --------------------------

/** `SpWriteStore` over the world, bound to one transaction's undo log. */
export class InMemorySpWriteStore implements SpWriteStore {
  constructor(
    private readonly world: InMemoryAssessmentWorld,
    private readonly undo: Array<() => void>,
  ) {}

  setCommentState(
    commentId: number,
    from: CommentState,
    to: CommentState,
  ): Promise<boolean> {
    this.world.statements += 1;
    this.world.writeLog.push('setCommentState');
    const held = this.world.comments.find(
      (c) => commentIdOf(this.world, c) === commentId,
    );
    // The conditional UPDATE: it matches only while the state is still `from`.
    if (
      held === undefined ||
      held.state !== from ||
      (held.deletedAt ?? null) !== null
    ) {
      return Promise.resolve(false);
    }
    held.state = to;
    this.undo.push(() => {
      held.state = from;
    });
    return Promise.resolve(true);
  }

  insertResponse(row: NewSpResponseRow): Promise<number> {
    this.world.statements += 1;
    this.world.writeLog.push('insertResponse');
    // chk_sp_responses_body
    if ((row.kind === 'accept') !== (row.body === null)) {
      return Promise.reject(new Error('chk_sp_responses_body'));
    }
    const created: SpResponseRecord = {
      id: this.world.nextSpResponseId++,
      commentId: row.commentId,
      kind: row.kind,
      body: row.body,
      responderName: row.responderName,
      responderEmail: row.responderEmail,
      programId: row.programId,
      createdAt: row.at,
    };
    this.world.spResponses.push(created);
    this.undo.push(() => {
      this.world.spResponses = this.world.spResponses.filter(
        (r) => r !== created,
      );
    });
    return Promise.resolve(created.id);
  }

  findPendingClarificationRequest(commentId: number): Promise<number | null> {
    this.world.statements += 1;
    const latest = this.world.spResponses
      .filter((r) => r.commentId === commentId)
      .sort((x, y) => y.id - x.id)[0];
    return Promise.resolve(
      latest?.kind === 'request_clarification' ? latest.id : null,
    );
  }

  insertClarificationAnswer(row: NewClarificationAnswerRow): Promise<number> {
    this.world.statements += 1;
    this.world.writeLog.push('insertClarificationAnswer');
    // uq_clarification_answers_response
    if (
      this.world.clarificationAnswers.some(
        (x) => x.responseId === row.responseId,
      )
    ) {
      return Promise.reject(
        Object.assign(new Error('Duplicate entry'), {
          code: 'ER_DUP_ENTRY',
          errno: 1062,
        }),
      );
    }
    const created = {
      id: this.world.nextClarificationAnswerId++,
      commentId: row.commentId,
      responseId: row.responseId,
      authorId: row.authorId,
      body: row.body,
      createdAt: row.at,
    };
    this.world.clarificationAnswers.push(created);
    this.undo.push(() => {
      this.world.clarificationAnswers = this.world.clarificationAnswers.filter(
        (x) => x !== created,
      );
    });
    return Promise.resolve(created.id);
  }
}

/** The SP unit of work over the world: the assessment write port and the SP port share one undo log. */
export class InMemorySpResponseUnitOfWork implements SpResponseUnitOfWork {
  constructor(private readonly world: InMemoryAssessmentWorld) {}

  async run<T>(work: (repositories: SpRepositories) => Promise<T>): Promise<T> {
    this.world.transactions += 1;
    const undo: Array<() => void> = [];
    try {
      return await work({
        assessments: new InMemoryAssessmentWriteStore(this.world, undo),
        sp: new InMemorySpWriteStore(this.world, undo),
      });
    } catch (error) {
      for (const revert of undo.reverse()) revert();
      throw error;
    }
  }
}
