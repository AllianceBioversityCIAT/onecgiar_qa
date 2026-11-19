// P2-3911: the comment thread as the program and the assessor read it. Pure.
// The program side carries NO assessor identity (no author id, nickname, name
// or email); the responder is named by name only. The assessor side adds the
// responder's email (AC12).
import type { CommentState } from '../../database/drizzle/schema/assessment-comments.js';
import type { SpResponseKind } from '../../database/drizzle/schema/sp-comment-responses.js';
import type { TimelineStepState } from '../../admin-config/timelines/timeline-view.js';
import type {
  ClarificationAnswerRecord,
  SpCommentRecord,
  SpResponseRecord,
} from './sp-view.store.js';
import { ANSWERED_STATES } from './sp-view.store.js';

export interface SpResponseView {
  id: number;
  kind: SpResponseKind;
  body: string | null;
  respondedBy: { name: string };
  respondedAt: string;
}

export interface AssessorResponseView extends Omit<
  SpResponseView,
  'respondedBy'
> {
  respondedBy: { name: string; email: string };
}

export interface ClarificationView {
  /** The id of the `request_clarification` response. */
  requestId: number;
  question: string;
  requestedAt: string;
  answer: { body: string; answeredAt: string } | null;
}

/** A comment as the program reads it (P2-3911). */
export interface SpCommentView {
  id: number;
  fieldKey: string;
  body: string;
  state: CommentState;
  createdAt: string;
  valueCopy: { value: unknown; labels?: unknown };
  valueTruncated: boolean;
  /** The latest response, or null. */
  response: SpResponseView | null;
  /** Every response, oldest first (the latest included). */
  history: SpResponseView[];
  clarifications: ClarificationView[];
}

/** A comment's thread as the assessor reads it (`…/sp-responses`). */
export interface AssessorThreadView {
  commentId: number;
  fieldKey: string;
  state: CommentState;
  /**
   * The caller can answer this comment's clarification now: they wrote it, they
   * can write on the timeline, a clarification is pending and the programs step
   * is in progress. The same checks as `POST …/clarification-answer`.
   */
  answerable: boolean;
  response: AssessorResponseView | null;
  history: AssessorResponseView[];
  clarifications: ClarificationView[];
}

export interface SpCounts {
  comments: number;
  answered: number;
}

/** The programs step has started: only then are comments visible to the program. */
export const commentsVisibleIn = (state: TimelineStepState | null): boolean =>
  state === 'in_progress' || state === 'closed';

const spResponseOf = (r: SpResponseRecord): SpResponseView => ({
  id: r.id,
  kind: r.kind,
  body: r.body,
  respondedBy: { name: r.responderName },
  respondedAt: r.createdAt.toISOString(),
});

const assessorResponseOf = (r: SpResponseRecord): AssessorResponseView => ({
  ...spResponseOf(r),
  respondedBy: { name: r.responderName, email: r.responderEmail },
});

function clarificationsOf(
  responses: readonly SpResponseRecord[],
  answers: readonly ClarificationAnswerRecord[],
): ClarificationView[] {
  return responses
    .filter((r) => r.kind === 'request_clarification')
    .map((r) => {
      const answer = answers.find((x) => x.responseId === r.id);
      return {
        requestId: r.id,
        question: r.body ?? '',
        requestedAt: r.createdAt.toISOString(),
        answer:
          answer === undefined
            ? null
            : {
                body: answer.body,
                answeredAt: answer.createdAt.toISOString(),
              },
      };
    });
}

/** Groups rows by comment id, each list ordered by id (oldest first). */
function byComment<T extends { id: number; commentId: number }>(
  rows: readonly T[],
): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const row of [...rows].sort((x, y) => x.id - y.id)) {
    const list = map.get(row.commentId) ?? [];
    list.push(row);
    map.set(row.commentId, list);
  }
  return map;
}

/** The program's view of each comment, in the order given. */
export function toSpComments(
  comments: readonly SpCommentRecord[],
  responses: readonly SpResponseRecord[],
  answers: readonly ClarificationAnswerRecord[],
): SpCommentView[] {
  const responsesOf = byComment(responses);
  const answersOf = byComment(answers);
  return comments.map((comment) => {
    const own = responsesOf.get(comment.id) ?? [];
    const history = own.map(spResponseOf);
    return {
      id: comment.id,
      fieldKey: comment.fieldKey,
      body: comment.body,
      state: comment.state,
      createdAt: comment.createdAt.toISOString(),
      valueCopy: comment.valueCopy,
      valueTruncated: comment.valueTruncated,
      response: history.at(-1) ?? null,
      history,
      clarifications: clarificationsOf(own, answersOf.get(comment.id) ?? []),
    };
  });
}

/** The assessor's view of each comment's program thread. */
export function toAssessorThreads(
  comments: ReadonlyArray<{
    id: number;
    fieldKey: string;
    state: CommentState;
  }>,
  responses: readonly SpResponseRecord[],
  answers: readonly ClarificationAnswerRecord[],
  answerable: (comment: { id: number; state: CommentState }) => boolean = () =>
    false,
): AssessorThreadView[] {
  const responsesOf = byComment(responses);
  const answersOf = byComment(answers);
  return comments.map((comment) => {
    const own = responsesOf.get(comment.id) ?? [];
    const history = own.map(assessorResponseOf);
    return {
      commentId: comment.id,
      fieldKey: comment.fieldKey,
      state: comment.state,
      answerable: answerable(comment),
      response: history.at(-1) ?? null,
      history,
      clarifications: clarificationsOf(own, answersOf.get(comment.id) ?? []),
    };
  });
}

/** The counts of the SP view: visible comments, and those the program answered. */
export function countsOf(
  comments: ReadonlyArray<{ state: CommentState }>,
): SpCounts {
  return {
    comments: comments.length,
    answered: comments.filter((x) => ANSWERED_STATES.includes(x.state)).length,
  };
}
