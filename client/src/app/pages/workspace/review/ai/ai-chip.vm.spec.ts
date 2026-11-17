import {
  AiSuggestionView,
  AiUnavailableReason,
  AvailableSuggestionView,
} from '../../../../core/api/ai-suggestions.models';
import { AI_NOT_AVAILABLE, AI_PENDING, AI_UNAVAILABLE_REASONS, toAiChipVm } from './ai-chip.vm';

const available = (over: Partial<AvailableSuggestionView> = {}): AvailableSuggestionView => ({
  status: 'available',
  fieldKey: 'general.gender_tag',
  suggestionId: 's1',
  signal: 'green',
  suggestedValue: 1,
  explanation: 'Training targeted at women farmers.',
  evidenceQuote: 'trained 1,200 women farmers',
  quoteVerified: true,
  evidenceSource: 'https://example.org/e.pdf',
  promptVersion: 'v2-1.0.0',
  modelId: 'm',
  ...over,
});

describe('toAiChipVm (FR-6)', () => {
  it.each([
    ['green', 'Looks consistent'],
    ['amber', 'Check'],
    ['red', 'Review'],
  ] as const)('labels an Impact Area %s signal "%s"', (signal, label) => {
    const vm = toAiChipVm(available({ signal }));
    expect(vm).toMatchObject({ kind: 'available', label, headline: null, quote: null });
  });

  it('never says "Incorrect"', () => {
    for (const signal of ['green', 'amber', 'red'] as const) {
      expect(JSON.stringify(toAiChipVm(available({ signal })))).not.toMatch(/incorrect/i);
    }
  });

  it('shows IRL / IUL as the supported level with its verified quote', () => {
    for (const fieldKey of [
      'innovation_dev.readiness_level',
      'innovation_use.use_level.innovation_use_level',
    ]) {
      expect(toAiChipVm(available({ fieldKey, suggestedValue: 4, signal: 'red' }))).toMatchObject({
        kind: 'available',
        headline: 'Evidence explicitly supports level 4',
        quote: 'trained 1,200 women farmers',
        label: 'Review',
      });
    }
  });

  it('treats an IRL without a verified quote as not available (no supporting quote)', () => {
    const vm = toAiChipVm(
      available({ fieldKey: 'innovation_dev.readiness_level', quoteVerified: false }),
    );
    expect(vm).toEqual({
      kind: 'unavailable',
      fieldKey: 'innovation_dev.readiness_level',
      label: AI_NOT_AVAILABLE,
      reason: 'No quote in the evidence supports a level.',
    });
  });

  it.each(Object.keys(AI_UNAVAILABLE_REASONS) as AiUnavailableReason[])(
    'explains the unavailable reason %s',
    (reason) => {
      const view: AiSuggestionView = {
        status: 'unavailable',
        fieldKey: 'general.climate_tag',
        unavailableReason: reason,
      };
      const vm = toAiChipVm(view);
      expect(vm).toMatchObject({ kind: 'unavailable', label: AI_NOT_AVAILABLE });
      expect(vm.kind === 'unavailable' && vm.reason.length).toBeGreaterThan(5);
    },
  );

  it('says a pending field is in progress', () => {
    expect(toAiChipVm({ status: 'pending', fieldKey: 'general.poverty_tag' })).toEqual({
      kind: 'pending',
      fieldKey: 'general.poverty_tag',
      label: AI_PENDING,
    });
  });

  it.each([
    [undefined, undefined, null],
    [false, null, null],
    [true, false, 'Copied by the reviewer'],
    [true, true, 'Copied and edited'],
  ] as const)('marks copied=%s edited=%s for the TPB as %s', (copied, edited, mark) => {
    const vm = toAiChipVm(available({ copiedByReviewer: copied, editedByReviewer: edited }));
    expect(vm.kind === 'available' && vm.reviewerMark).toBe(mark);
  });
});
