import { AvailableSuggestionView } from '../../../../core/api/ai-suggestions.models';

/** The worker's contract 2.0.0 examples (`ai-suggestion-item.result-category.json`, `.use-numbers.json`) as views. */
export const RESULT_CATEGORY_VIEW: AvailableSuggestionView = {
  status: 'available',
  fieldKey: 'general.result_type',
  suggestionId: '1b2c3d4e5f60718293a4b5c6d7e8f901',
  signal: 'indicative',
  valueKind: 'category',
  suggestedValue: 'Innovation',
  explanation:
    '- Novelty: a new seed-certification process. - Improvement and positive change are described.',
  quoteVerified: false,
  evidenceSource: null,
  promptVersion: 'v1-1.0.0',
  modelId: 'anthropic.claude-haiku-5-5',
};

export const USE_NUMBERS_VIEW: AvailableSuggestionView = {
  status: 'available',
  fieldKey: 'innovation_use.current_use.actors',
  suggestionId: '2c3d4e5f60718293a4b5c6d7e8f90a12',
  signal: 'indicative',
  valueKind: 'use_numbers',
  suggestedValue: [
    {
      geolocation: 'Kenya',
      men: 500,
      quantity: 1200,
      user: 'actors',
      user_type: 'Farmers/ (agro)pastoralist/ herders/ fishers',
      women: 700,
    },
    { quantity: 50.5, user: 'other type', user_type: 'hectares' },
  ],
  explanation: 'Total 1,250: 1,200 farmers and 50 hectares reported in the 2025 project report.',
  quoteVerified: false,
  evidenceSource: null,
  promptVersion: 'v1-1.0.0',
  modelId: 'anthropic.claude-haiku-5-5',
  coversFieldKeys: [
    'innovation_use.current_use.organizations',
    'innovation_use.current_use.measures',
  ],
};

/** Use numbers where the evidence reports none (an empty list, never null). */
export const EMPTY_USE_NUMBERS_VIEW: AvailableSuggestionView = {
  ...(USE_NUMBERS_VIEW as Extract<AvailableSuggestionView, { valueKind: 'use_numbers' }>),
  suggestedValue: [],
};
