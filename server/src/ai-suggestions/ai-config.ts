// @akili-spec assessment/ai-suggestions
import type { ConfigItem } from '../admin-config/field-config/field-config-diff.js';
import type {
  AiProductionContract,
  AiProductionField,
} from './production-contract.js';
import { AI_PRODUCTION } from './production.js';

/** IRL and IUL: the level fields of the pilot (FR-6, FR-8 `validated_above_ai`, FR-11). */
export const AI_LEVEL_FIELDS: readonly string[] = [
  'innovation_dev.readiness_level',
  'innovation_use.use_level.innovation_use_level',
];

/** The membership statuses a reviewer assesses; `auto_validated` and `not_in_qa` get no job (FR-1). */
export const AI_ELIGIBLE_STATUS = 'pending';

/**
 * FR-1: the fields that get an AI suggestion for one result type, in the
 * order of `production.json`: a field must be in production AND Assessed in
 * the configuration the membership is judged by. The admin's "AI input" flag
 * is not read: the Fields screen has had no AI column since 2026-11-11, so it
 * cannot be set (back lead, 2026-11-17). The configuration items are already
 * per result type, so a field the type does not have is absent.
 */
export function eligibleFields(
  items: readonly ConfigItem[],
  production: AiProductionContract = AI_PRODUCTION,
): string[] {
  const assessed = new Set(
    items
      .filter((item) => item.visibility === 'assessed')
      .map((item) => item.fieldKey),
  );
  return Object.keys(production.fields).filter((key) => assessed.has(key));
}

/** DD-1: one run per load, so a lot retry and a re-enqueue address the same counters. */
export function aiRunIdOf(loadId: number): string {
  return `load-${loadId}`;
}

/** The production entry of a field, or undefined when the AI does not cover it. */
export function productionFieldOf(
  fieldKey: string,
  production: AiProductionContract = AI_PRODUCTION,
): AiProductionField | undefined {
  return Object.hasOwn(production.fields, fieldKey)
    ? production.fields[fieldKey]
    : undefined;
}
