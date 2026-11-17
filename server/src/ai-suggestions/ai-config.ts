// @akili-spec assessment/ai-suggestions
import type { ConfigItem } from '../admin-config/field-config/field-config-diff.js';
import { AI_PRODUCTION, type AiProductionContract } from './production.js';

/** The membership statuses a reviewer assesses; `auto_validated` and `not_in_qa` get no job (FR-1). */
export const AI_ELIGIBLE_STATUS = 'pending';

/**
 * FR-1: the AI-input fields of one result type, in the order of
 * `production.json`. A field must be in production, marked AI input by the
 * admin and not Hidden in the configuration the membership is judged by. The
 * configuration items are already per result type, so a field the type does
 * not have is absent.
 */
export function eligibleFields(
  items: readonly ConfigItem[],
  production: AiProductionContract = AI_PRODUCTION,
): string[] {
  const marked = new Set(
    items
      .filter((item) => item.isAiInput && item.visibility !== 'hidden')
      .map((item) => item.fieldKey),
  );
  return production.fieldKeys.filter((key) => marked.has(key));
}

/** DD-1: one run per load, so a lot retry and a re-enqueue address the same counters. */
export function aiRunIdOf(loadId: number): string {
  return `load-${loadId}`;
}
