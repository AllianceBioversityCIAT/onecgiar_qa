// @akili-spec assessment/ai-suggestions
import { describe, expect, it } from 'vitest';
import type { ConfigItem } from '../admin-config/field-config/field-config-diff.js';
import { aiRunIdOf, eligibleFields } from './ai-config.js';

const item = (
  fieldKey: string,
  over: Partial<ConfigItem> = {},
): ConfigItem => ({
  resultTypeKey: 'innovation_dev',
  fieldKey,
  visibility: 'assessed',
  isCore: false,
  isAiInput: true,
  ...over,
});

describe('eligibleFields (FR-1)', () => {
  it('keeps the Assessed production fields, in production order', () => {
    expect(
      eligibleFields([
        item('innovation_dev.readiness_level'),
        item('general.climate_tag'),
        item('general.gender_tag'),
      ]),
    ).toEqual([
      'general.gender_tag',
      'general.climate_tag',
      'innovation_dev.readiness_level',
    ]);
  });

  it('ignores the AI input flag: an Assessed field counts, marked or not', () => {
    expect(
      eligibleFields([
        item('general.gender_tag', { isAiInput: false }),
        item('general.poverty_tag'),
      ]),
    ).toEqual(['general.gender_tag', 'general.poverty_tag']);
  });

  it('drops a View only field', () => {
    expect(
      eligibleFields([item('general.gender_tag', { visibility: 'view_only' })]),
    ).toEqual([]);
  });

  it('drops a Hidden field', () => {
    expect(
      eligibleFields([item('general.gender_tag', { visibility: 'hidden' })]),
    ).toEqual([]);
  });

  it('drops an Assessed field that is not in production (no job, no pending)', () => {
    expect(eligibleFields([item('general.title')])).toEqual([]);
  });

  it('a field the type does not have is absent from its items, so absent here', () => {
    // innovation_dev has no IUL item: no IUL job.
    expect(eligibleFields([item('innovation_dev.readiness_level')])).toEqual([
      'innovation_dev.readiness_level',
    ]);
  });
});

describe('aiRunIdOf (DD-1)', () => {
  it('is one run per load', () => {
    expect(aiRunIdOf(42)).toBe('load-42');
  });
});
