// @akili-spec assessment/ai-suggestions
import { describe, expect, it } from 'vitest';
import { assertAiSchema } from '../../test/support/ai-contract.js';
import type { AiSuggestionItem } from '../ai-suggestions/ai-suggestion.store.js';
import { RoleCode } from '../users/permissions.js';
import {
  AI_UNAVAILABLE_REASONS,
  aiAudienceOf,
  checkAboveAi,
  isEdited,
  toSuggestionViews,
} from './ai-suggestions-rules.js';
import type { MembershipFacts, ReviewerRow, WorklistAccess } from './scope.js';

const row = (role: RoleCode): ReviewerRow => ({
  role,
  round: 1,
  audience: 'assessors',
  resultTypes: 'all',
  programs: { mode: 'all', excluded: [] },
});
const access = (
  roles: RoleCode[],
  admin = false,
  disabledRoles: RoleCode[] = [],
): WorklistAccess => ({ reviewerRows: roles.map(row), admin, disabledRoles });

describe('aiAudienceOf (FR-5)', () => {
  it.each([
    [
      [RoleCode.ASSESSOR],
      false,
      { kind: 'reviewer', roleCode: RoleCode.ASSESSOR },
    ],
    [
      [RoleCode.LEAD_ASSESSOR],
      false,
      { kind: 'reviewer', roleCode: RoleCode.LEAD_ASSESSOR },
    ],
    [[RoleCode.TPB], false, { kind: 'tpb' }],
    [[RoleCode.PPU], false, { kind: 'forbidden' }],
    [[], true, { kind: 'admin' }],
    [[], false, { kind: 'none' }],
    // A reviewer row wins over the admin answer and over another row.
    [
      [RoleCode.TPB, RoleCode.ASSESSOR],
      true,
      { kind: 'reviewer', roleCode: RoleCode.ASSESSOR },
    ],
    [[RoleCode.TPB], true, { kind: 'tpb' }],
    [[RoleCode.PPU], true, { kind: 'forbidden' }],
  ] as const)('%j admin=%s → %j', (roles, admin, expected) => {
    expect(aiAudienceOf(access([...roles], admin))).toEqual(expected);
  });

  it('a PPU whose row is not enabled yet is forbidden, not "none"', () => {
    expect(aiAudienceOf(access([], false, [RoleCode.PPU]))).toEqual({
      kind: 'forbidden',
    });
  });

  it('a TPB or LEAD whose row is not enabled yet sees nothing (the 404)', () => {
    expect(
      aiAudienceOf(access([], false, [RoleCode.TPB, RoleCode.LEAD_ASSESSOR])),
    ).toEqual({ kind: 'none' });
  });
});

describe('aiAudienceOf on a membership (DD-T11: the effective role)', () => {
  const round2 = (role: RoleCode): ReviewerRow => ({
    ...row(role),
    round: 2,
  });
  const leadAndTpb: WorklistAccess = {
    reviewerRows: [round2(RoleCode.LEAD_ASSESSOR), round2(RoleCode.TPB)],
    admin: false,
    disabledRoles: [],
  };
  const facts = (leadEscalated: boolean): MembershipFacts => ({
    resultType: 'policy_change',
    programId: 1,
    round: 2,
    status: 'pending',
    ended: false,
    endReason: null,
    leadEscalated,
    tpbEscalated: false,
  });

  it('a Lead who is also TPB gets the TPB mode on pending_tpb_review and the Lead mode on pending, in either row order', () => {
    for (const access of [
      leadAndTpb,
      { ...leadAndTpb, reviewerRows: [...leadAndTpb.reviewerRows].reverse() },
    ]) {
      expect(aiAudienceOf(access, facts(true))).toEqual({ kind: 'tpb' });
      expect(aiAudienceOf(access, facts(false))).toEqual({
        kind: 'reviewer',
        roleCode: RoleCode.LEAD_ASSESSOR,
      });
    }
  });

  it('an ADMIN with no effective role reads in the admin mode', () => {
    expect(
      aiAudienceOf(
        { reviewerRows: [], admin: true, disabledRoles: [] },
        facts(true),
      ),
    ).toEqual({ kind: 'admin' });
  });
});

const base = {
  resultCode: 1001,
  snapKey: '2026#000001#00000001#0000000001',
  promptVersion: 'v2-1.0.0',
  runId: 'load-1',
  createdAt: '2026-11-20T12:00:00Z',
};
const available = (
  fieldKey: string,
  over: Partial<AiSuggestionItem> = {},
): AiSuggestionItem =>
  ({
    ...base,
    fieldKey,
    suggestionId: `${fieldKey.length.toString(16).padStart(2, '0')}${'a'.repeat(30)}`,
    status: 'available',
    signal: 'green',
    suggestedValue: 1,
    reportedValue: 1,
    explanation: 'Consistent with the evidence.',
    evidenceQuote: 'a quote',
    evidenceSource: 'https://example.org/e.pdf',
    quoteVerified: true,
    modelId: 'anthropic.claude-haiku-5-5',
    ...over,
  }) as AiSuggestionItem;
const unavailable = (fieldKey: string, reason?: string): AiSuggestionItem =>
  ({
    ...base,
    fieldKey,
    suggestionId: 'b'.repeat(32),
    status: 'unavailable',
    ...(reason === undefined ? {} : { unavailableReason: reason }),
  }) as AiSuggestionItem;

describe('toSuggestionViews (FR-4)', () => {
  it('one view per eligible field, in that order: available, unavailable, pending', () => {
    const views = toSuggestionViews(
      ['general.gender_tag', 'general.climate_tag', 'general.poverty_tag'],
      [
        unavailable('general.climate_tag', 'private_link'),
        available('general.gender_tag'),
      ],
    );
    expect(views.map((v) => [v.fieldKey, v.status])).toEqual([
      ['general.gender_tag', 'available'],
      ['general.climate_tag', 'unavailable'],
      ['general.poverty_tag', 'pending'],
    ]);
    for (const view of views) assertAiSchema('ai-suggestion-view', view);
  });

  it('does not show a stored item of a field that is not eligible', () => {
    expect(
      toSuggestionViews(
        ['general.gender_tag'],
        [available('general.climate_tag')],
      ),
    ).toEqual([{ status: 'pending', fieldKey: 'general.gender_tag' }]);
  });

  it.each(AI_UNAVAILABLE_REASONS)('keeps the reason %s', (reason) => {
    const [view] = toSuggestionViews(
      ['general.gender_tag'],
      [unavailable('general.gender_tag', reason)],
    );
    expect(view).toEqual({
      status: 'unavailable',
      fieldKey: 'general.gender_tag',
      unavailableReason: reason,
    });
    assertAiSchema('ai-suggestion-view', view);
  });

  it('reads an unknown or missing reason as failed', () => {
    for (const reason of ['something_new', undefined]) {
      const [view] = toSuggestionViews(
        ['general.gender_tag'],
        [unavailable('general.gender_tag', reason)],
      );
      expect(view).toMatchObject({ unavailableReason: 'failed' });
    }
  });

  it('maps the nullable quote, source, verification and model to schema-valid values and reports the id', () => {
    const defects: string[] = [];
    const item = available('innovation_dev.readiness_level', {
      evidenceQuote: undefined,
      evidenceSource: undefined,
      quoteVerified: undefined,
      modelId: undefined,
    });
    const [view] = toSuggestionViews(
      ['innovation_dev.readiness_level'],
      [item],
      undefined,
      defects,
    );
    expect(view).toMatchObject({
      // Contract 2.0.0: a missing quote is null (indicative fields have none).
      evidenceQuote: null,
      evidenceSource: null,
      quoteVerified: false,
      modelId: '',
    });
    assertAiSchema('ai-suggestion-view', view);
    expect(defects).toEqual([item.suggestionId]);
  });

  it('shows an available item without a usable value as invalid_output', () => {
    const defects: string[] = [];
    const [view] = toSuggestionViews(
      ['general.gender_tag'],
      [available('general.gender_tag', { suggestedValue: undefined })],
      undefined,
      defects,
    );
    expect(view).toEqual({
      status: 'unavailable',
      fieldKey: 'general.gender_tag',
      unavailableReason: 'invalid_output',
    });
    expect(defects).toHaveLength(1);
  });

  it('adds the copied/edited mark only when marks are given (TPB), with false/null defaults', () => {
    const item = available('general.gender_tag');
    const [none] = toSuggestionViews(['general.gender_tag'], [item]);
    expect(none).not.toHaveProperty('copiedByReviewer');
    expect(none).not.toHaveProperty('editedByReviewer');
    const [unmarked] = toSuggestionViews(
      ['general.gender_tag'],
      [item],
      new Map(),
    );
    expect(unmarked).toMatchObject({
      copiedByReviewer: false,
      editedByReviewer: null,
    });
    const [marked] = toSuggestionViews(
      ['general.gender_tag'],
      [item],
      new Map([[item.suggestionId, { copied: true, edited: true }]]),
    );
    expect(marked).toMatchObject({
      copiedByReviewer: true,
      editedByReviewer: true,
    });
    for (const view of [none, unmarked, marked])
      assertAiSchema('ai-suggestion-view', view);
  });
});

describe('isEdited (FR-8 comment_saved)', () => {
  it('ignores whitespace around and inside the text', () => {
    expect(
      isEdited(
        '  Consistent   with\nthe evidence. ',
        'Consistent with the evidence.',
      ),
    ).toBe(false);
  });
  it('sees any other change', () => {
    expect(
      isEdited(
        'Consistent with the evidence!',
        'Consistent with the evidence.',
      ),
    ).toBe(true);
  });
});

describe('checkAboveAi (FR-8 validated_above_ai)', () => {
  const irl = {
    fieldKey: 'innovation_dev.readiness_level',
    suggestedValue: 3,
    reportedValue: 6,
  };
  const ok = {
    aiLevel: 3,
    validatedLevel: 6,
    reason: 'Pilot report shows field use.',
  };

  it('accepts IRL and IUL 2+ above the stored AI level with a one-line reason', () => {
    expect(checkAboveAi(irl, ok)).toBeNull();
    expect(
      checkAboveAi(
        {
          ...irl,
          fieldKey: 'innovation_use.use_level.innovation_use_level',
          reportedValue: 5,
        },
        { ...ok, validatedLevel: 5 },
      ),
    ).toBeNull();
  });

  it('refuses a difference of exactly 1', () => {
    expect(
      checkAboveAi({ ...irl, reportedValue: 4 }, { ...ok, validatedLevel: 4 }),
    ).toBe('difference_below_2');
  });

  it('refuses an impact-area tag', () => {
    expect(checkAboveAi({ ...irl, fieldKey: 'general.gender_tag' }, ok)).toBe(
      'not_a_level_field',
    );
  });

  it('refuses an AI level that is not the stored one', () => {
    expect(checkAboveAi(irl, { ...ok, aiLevel: 2 })).toBe('ai_level_mismatch');
  });

  it('refuses a validated level that is not the reported one', () => {
    expect(checkAboveAi(irl, { ...ok, validatedLevel: 7 })).toBe(
      'reported_level_mismatch',
    );
  });

  it('refuses a reason with a line break, blank, or over 200 characters', () => {
    for (const reason of ['two\nlines', '   ', 'x'.repeat(201)]) {
      expect(checkAboveAi(irl, { ...ok, reason })).toBe('reason_not_one_line');
    }
  });
});
