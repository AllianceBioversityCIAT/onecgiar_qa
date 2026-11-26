// @akili-spec escalation/round-2-ppu
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

// Expected values are literals from P2-3917 AC1, AC3, AC4, AC7 (FR-1, FR-3,
// FR-6): only cases (`tpb_sided_assessor`) are decidable for a PPU, each
// carries the Lead's and the TPB's decisions as context, and the step-5 green
// is the PPU's mark, else the TPB's, else the Lead's, else the carried one.

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
  tpbDecision: null,
  tpbDecisionBody: null,
  tpbDecidedAt: null,
  ...over,
});

const view = (keys: string[]): AssessmentView => ({
  sections: [{ key: 'general', label: 'General', fields: keys.map((k) => field(k)) }],
  other: [],
});

const input = (over: Partial<RoundViewInput>): RoundViewInput => ({
  round: 2,
  role: RoleCode.PPU,
  changedFields: null,
  stored: new Map(),
  roundOneGreens: new Set(),
  thread: [],
  userId: 30,
  ownDecisions: new Map(),
  ended: false,
  leadStored: new Map(),
  tpbStored: new Map(),
  ...over,
});

const fieldOf = (annotated: ReturnType<typeof annotateForRound>, key: string) =>
  annotated.sections[0]!.fields.find((f) => f.key === key)!;

describe('the PPU thread (FR-1, FR-3)', () => {
  const thread = [
    row(1, 'a', 'tpb_sided_assessor', {
      leadDecision: 'escalate',
      leadDecisionBody: 'Lead says escalate',
      leadDecidedAt: new Date('2026-11-25T10:00:00Z'),
      tpbDecision: 'tpb_agree_assessor',
      tpbDecisionBody: 'The assessor is right',
      tpbDecidedAt: new Date('2026-11-30T10:00:00Z'),
    }),
    row(2, 'a', 'tpb_sided_program', {
      tpbDecision: 'tpb_agree_program',
      tpbDecisionBody: 'Fine',
      tpbDecidedAt: new Date('2026-11-30T10:05:00Z'),
    }),
    row(3, 'b', 'done', {
      decision: 'ppu_done',
      decisionBody: null,
      decidedAt: new Date('2026-12-04T09:00:00Z'),
    }),
  ];
  const annotated = annotateForRound(view(['a', 'b']), input({ thread }));

  it('offers ppu_done on cases only', () => {
    expect(
      fieldOf(annotated, 'a').thread.map((i) => [i.commentId, i.decidable, i.choices]),
    ).toEqual([
      [1, true, ['ppu_done']],
      [2, false, []],
    ]);
    expect(fieldOf(annotated, 'b').thread[0]).toMatchObject({
      decidable: false,
      decision: { decision: 'ppu_done', body: null },
    });
  });

  it("carries the Lead's and the TPB's decisions with their reasons", () => {
    expect(fieldOf(annotated, 'a').thread[0]).toMatchObject({
      round: 1,
      leadDecision: { decision: 'escalate', body: 'Lead says escalate' },
      tpbDecision: {
        decision: 'tpb_agree_assessor',
        body: 'The assessor is right',
        decidedAt: '2026-11-30T10:00:00.000Z',
      },
    });
  });

  it('shows the TPB decision to the PPU only', () => {
    const asTpb = annotateForRound(
      view(['a']),
      input({ thread, role: RoleCode.TPB }),
    );
    expect(fieldOf(asTpb, 'a').thread[0]!.tpbDecision).toBeUndefined();
  });

  it('offers nothing once the result ended', () => {
    const ended = annotateForRound(view(['a']), input({ thread, ended: true }));
    expect(fieldOf(ended, 'a').thread[0]).toMatchObject({
      decidable: false,
      choices: [],
    });
  });
});

describe('the step-5 effective green (design § 5)', () => {
  it.each<[string, Partial<RoundViewInput>, boolean]>([
    ['the PPU mark wins', { stored: new Map([['a', true]]), tpbStored: new Map([['a', false]]) }, true],
    ['no PPU mark: the TPB mark', { tpbStored: new Map([['a', true]]), leadStored: new Map([['a', false]]) }, true],
    ['no PPU nor TPB mark: the Lead mark', { leadStored: new Map([['a', true]]) }, true],
    ['no mark: the carried round-1 green', { roundOneGreens: new Set(['a']) }, true],
    ['a grey TPB mark over a Lead green', { tpbStored: new Map([['a', false]]), leadStored: new Map([['a', true]]) }, false],
  ])('%s', (_name, over, green) => {
    expect(
      fieldOf(annotateForRound(view(['a']), input(over)), 'a').effectiveValidated,
    ).toBe(green);
  });
});
