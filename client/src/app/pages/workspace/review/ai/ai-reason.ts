import { AvailableSuggestionView } from '../../../../core/api/ai-suggestions.models';
import { isLevelField } from './ai-chip.vm';
import type { AiSuggestionsStore } from './ai-suggestions-store';

/** A reason is one line of at most this many characters (server `ai-suggestion-event.schema.json`). */
export const AI_REASON_MAX = 200;

/**
 * FR-10: validating IRL / IUL with a reported level 2 or more above the AI's asks for a one-line reason first.
 * Only an available suggestion counts; a pending or unavailable one never asks.
 */
export function needsReason(
  fieldKey: string,
  reportedLevel: number | null,
  ai: AvailableSuggestionView | null,
): boolean {
  if (!isLevelField(fieldKey) || ai === null || reportedLevel === null) return false;
  return reportedLevel - ai.suggestedValue >= 2;
}

/** The problem with a typed reason, or null when it can be saved. */
export function reasonError(reason: string): string | null {
  const text = reason.trim();
  if (text === '') return 'Write why the reported level holds.';
  if (/[\r\n]/.test(reason)) return 'Keep the reason on one line.';
  if (text.length > AI_REASON_MAX) return `Keep the reason under ${AI_REASON_MAX + 1} characters.`;
  return null;
}

/**
 * Event first, then the validation (FR-10 order). The event never blocks: `validatedAbove` resolves even when
 * the server is down, and the validation runs regardless. Returns what `validate` returns.
 */
export async function validateWithReason<T>(
  store: Pick<AiSuggestionsStore, 'validatedAbove'>,
  fieldKey: string,
  validatedLevel: number,
  reason: string,
  validate: () => Promise<T>,
): Promise<T> {
  await store.validatedAbove(fieldKey, validatedLevel, reason.trim());
  return validate();
}
