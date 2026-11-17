// @akili-spec assessment/ai-suggestions
/**
 * The worker's production contract (`contract/production.json`, DD-5): the
 * prompt version the API puts on every job and the fields it covers. A copy, so
 * the version moves with a deploy; `ai-contract.spec.ts` fails when this
 * constant and the copied JSON differ. Refresh both with
 * `scripts/sync-ai-contract.sh`.
 */
export const AI_PRODUCTION = {
  promptVersion: 'v2-1.0.0',
  fieldKeys: [
    'general.gender_tag',
    'general.climate_tag',
    'general.nutrition_tag',
    'general.environment_tag',
    'general.poverty_tag',
    'innovation_dev.readiness_level',
    'innovation_use.use_level.innovation_use_level',
  ],
  fieldScales: {
    'general.gender_tag': { min: 0, max: 2 },
    'general.climate_tag': { min: 0, max: 2 },
    'general.nutrition_tag': { min: 0, max: 2 },
    'general.environment_tag': { min: 0, max: 2 },
    'general.poverty_tag': { min: 0, max: 2 },
    'innovation_dev.readiness_level': { min: 0, max: 9 },
    'innovation_use.use_level.innovation_use_level': { min: 0, max: 9 },
  },
} as const satisfies AiProductionContract;

export interface AiProductionContract {
  promptVersion: string;
  fieldKeys: readonly string[];
  fieldScales: Readonly<Record<string, { min: number; max: number }>>;
}

/** IRL and IUL: the level fields of the pilot (FR-6, FR-8 `validated_above_ai`). */
export const AI_LEVEL_FIELDS: readonly string[] = [
  'innovation_dev.readiness_level',
  'innovation_use.use_level.innovation_use_level',
];
