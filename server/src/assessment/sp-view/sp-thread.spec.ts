import {
  commentsVisibleIn,
  countsOf,
  toAssessorThreads,
  toSpComments,
} from './sp-thread.js';
import type { SpResponseRecord } from './sp-view.store.js';

const at = (iso: string) => new Date(iso);
const response = (
  id: number,
  kind: SpResponseRecord['kind'],
  body: string | null,
): SpResponseRecord => ({
  id,
  commentId: 1,
  kind,
  body,
  responderName: 'Sam Program',
  responderEmail: 'sp-user@example.org',
  programId: 1,
  createdAt: at(`2026-11-1${id}T10:00:00Z`),
});

describe('SP threads (P2-3911)', () => {
  const comment = {
    id: 1,
    fieldKey: 'general.title',
    body: 'Fix the title',
    state: 'disagreed' as const,
    valueCopy: { value: 'x' },
    valueTruncated: false,
    createdAt: at('2026-11-10T10:00:00Z'),
  };
  // Given out of order on purpose: the thread is ordered by id.
  const responses = [
    response(3, 'disagree', 'It is right'),
    response(1, 'request_clarification', 'What is wrong?'),
    response(2, 'accept', null),
  ];
  const answers = [
    {
      id: 9,
      commentId: 1,
      responseId: 1,
      body: 'The year',
      createdAt: at('2026-11-11T12:00:00Z'),
    },
  ];

  it('keeps the latest response, the whole history oldest first, and the clarifications with their answers', () => {
    const [view] = toSpComments([comment], responses, answers);
    expect(view!.response).toMatchObject({ id: 3, kind: 'disagree' });
    expect(view!.history.map((h) => h.id)).toEqual([1, 2, 3]);
    expect(view!.clarifications).toEqual([
      {
        requestId: 1,
        question: 'What is wrong?',
        requestedAt: '2026-11-11T10:00:00.000Z',
        answer: { body: 'The year', answeredAt: '2026-11-11T12:00:00.000Z' },
      },
    ]);
    expect(JSON.stringify(view)).not.toContain('sp-user@example.org');
    expect(view!.response!.respondedBy).toEqual({ name: 'Sam Program' });
  });

  it('gives the assessor the responder email too', () => {
    const [thread] = toAssessorThreads([comment], responses, answers);
    expect(thread!.response!.respondedBy).toEqual({
      name: 'Sam Program',
      email: 'sp-user@example.org',
    });
    expect(thread!.commentId).toBe(1);
  });

  it('shows comments only once the programs step started', () => {
    expect(commentsVisibleIn('upcoming')).toBe(false);
    expect(commentsVisibleIn(null)).toBe(false);
    expect(commentsVisibleIn('in_progress')).toBe(true);
    expect(commentsVisibleIn('closed')).toBe(true);
  });

  it('counts accepted, accepted with a comment and disagreed as answered', () => {
    expect(
      countsOf([
        { state: 'open' },
        { state: 'accepted' },
        { state: 'accepted_with_comment' },
        { state: 'disagreed' },
        { state: 'clarification_requested' },
      ]),
    ).toEqual({ comments: 5, answered: 3 });
  });
});
