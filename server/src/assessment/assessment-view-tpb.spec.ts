// @akili-spec escalation/round-2-tpb
import { describe, expect, it } from 'vitest';
import type { CommentState } from '../database/drizzle/schema/assessment-comments.js';
import { RoleCode } from '../users/permissions.js';
import type { EscalationThreadRow } from './assessment.store.js';
import {
  annotateForRound,
  type AssessmentView,
  type RoundViewInput,
  type ViewField,
} from './assessment-view.js';

// Expected values are literals from P2-3916 AC3, AC4, AC7 (FR-3, FR-4, FR-6):
// only `escalated` items are decidable for a TPB, each carries the Lead's
// decision as context and its round, and the step-4 green is the TPB's mark,
// else the step-3 one, else the carried round-1 one.

const field = (key: string, core = true): ViewField => ({
  key,
  label: key,
  type: 'text',
  mode: 'assessed',
  core,
  value: `${key} now`,
  labels: null,
  validated: false,
  comments: [],
  notApplicable: false,
});

const row = (
  commentId: number,
  fieldKey: string,
  state: CommentState,
  over: Partial<EscalationThreadRow> = {},
): EscalationThreadRow => ({
  commentId,
  fieldKey,
  authorId: 5,
  authorNickname: 'Ana',
  authorAsAdmin: false,
  body: `Comment ${commentId}`,
  state,
  round: 1,
  valueCopy: { value: `${fieldKey} then` },
  valueTruncated: false,
  createdAt: new Date('2026-11-14T09:00:00Z'),
  responseId: null,
  responseKind: null,
  responseBody: null,
  responderName: null,
  respondedAt: null,
  answerBody: null,
  answeredAt: null,
  decision: null,
  decisionBody: null,
  decidedAt: null,
  leadDecision: null,
  leadDecisionBody: null,
  leadDecidedAt: null,
  ...over,
});

const view = (keys: string[]): AssessmentView => ({
  sections: [{ key: 'general', label: 'General', fields: keys.map((k) => field(k)) }],
  other: [],
});

const input = (over: Partial<RoundViewInput>): RoundViewInput => ({
  round: 2,
  role: RoleCode.TPB,
  changedFields: null,
  stored: new Map(),
  roundOneGreens: new Set(),
  thread: [],
  userId: 30,
  ownDecisions: new Map(),
  ended: false,
  leadStored: new Map(),
  ...over,
});

const fieldOf = (annotated: ReturnType<typeof annotateForRound>, key: string) =>
  annotated.sections[0]!.fields.find((f) => f.key === key)!;

describe('the TPB thread (FR-3, FR-4)', () => {
  const thread = [
    row(1, 'a', 'escalated', {
      leadDecision: 'escalate',
      leadDecisionBody: 'Program figure is wrong',
      leadDecidedAt: new Date('2026-11-25T10:00:00Z'),
    }),
    row(2, 'a', 'lead_sided_program', {
      leadDecision: 'agree_program',
      leadDecisionBody: 'Fine',
      leadDecidedAt: new Date('2026-11-25T10:05:00Z'),
    }),
    row(3, 'b', 'escalated', {
      round: 2,
      authorId: 20,
      authorNickname: 'Lena',
      leadDecision: 'escalate',
      leadDecisionBody: 'My own point',
      leadDecidedAt: new Date('2026-11-25T11:00:00Z'),
      decision: 'tpb_agree_assessor',
      decisionBody: 'The assessor is right',
      decidedAt: new Date('2026-11-29T09:00:00Z'),
    }),
  ];
  const annotated = annotateForRound(view(['a', 'b']), input({ thread }));

  it('offers both TPB choices on escalated items only', () => {
    const [escalated, closed] = fieldOf(annotated, 'a').thread;
    expect(escalated).toMatchObject({
      commentId: 1,
      decidable: true,
      choices: ['tpb_agree_program', 'tpb_agree_assessor'],
    });
    expect(closed).toMatchObject({ commentId: 2, decidable: false, choices: [] });
  });

  it("carries the Lead's decision as context and the comment's round", () => {
    expect(fieldOf(annotated, 'a').thread[0]).toMatchObject({
      round: 1,
      leadDecision: {
        decision: 'escalate',
        body: 'Program figure is wrong',
        decidedAt: '2026-11-25T10:00:00.000Z',
      },
    });
    expect(fieldOf(annotated, 'b').thread[0]).toMatchObject({
      round: 2,
      author: { id: 20, nickname: 'Lena' },
      decision: {
        decision: 'tpb_agree_assessor',
        body: 'The assessor is right',
        decidedAt: '2026-11-29T09:00:00.000Z',
      },
      leadDecision: { decision: 'escalate', body: 'My own point' },
    });
  });

  it('offers nothing once the review ended or the step is closed (T-17 rule)', () => {
    const ended = annotateForRound(view(['a']), input({ thread, ended: true }));
    expect(fieldOf(ended, 'a').thread[0]).toMatchObject({
      decidable: false,
      choices: [],
    });
  });

  it('offers nothing to a reader without the TPB role (ADMIN)', () => {
    const admin = annotateForRound(view(['a']), input({ thread, role: null }));
    expect(fieldOf(admin, 'a').thread[0]).toMatchObject({
      decidable: false,
      choices: [],
    });
  });
});

describe('the step-4 effective green (FR-6, design § 6)', () => {
  it.each<[string, Partial<RoundViewInput>, boolean, boolean]>([
    ['the TPB mark wins', { stored: new Map([['a', true]]), leadStored: new Map([['a', false]]) }, true, false],
    ['the TPB grey mark wins over a Lead green', { stored: new Map([['a', false]]), leadStored: new Map([['a', true]]) }, false, false],
    ['no TPB mark: the Lead mark', { leadStored: new Map([['a', true]]) }, true, false],
    ['no mark at all: the carried round-1 green', { roundOneGreens: new Set(['a']) }, true, true],
    ['nothing: grey', {}, false, false],
  ])('%s', (_name, over, green, carried) => {
    const f = fieldOf(annotateForRound(view(['a']), input(over)), 'a');
    expect(f.effectiveValidated).toBe(green);
    expect(f.carried).toBe(carried);
  });

  it("does not let the Lead's own (round-2) comment break the carried green", () => {
    const f = fieldOf(
      annotateForRound(
        view(['a']),
        input({
          roundOneGreens: new Set(['a']),
          thread: [row(9, 'a', 'withdrawn', { round: 2 })],
        }),
      ),
      'a',
    );
    expect(f.effectiveValidated).toBe(true);
  });
});
