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
  // IRL / IUL only: an indicative field (category, use numbers) never asks for a reason.
  if (!isLevelField(fieldKey) || ai === null || reportedLevel === null) return false;
  if (ai.valueKind !== 'level') return false;
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

/** A level as Reporting sends it (a number, or a numeric string); null for anything else. */
export function levelOf(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  if (typeof value === 'string' && /^\s*\d+\s*$/.test(value)) return Number(value);
  return null;
}

/**
 * Event first, then the validation (FR-10 order). The validation runs only when the server stored the reason:
 * a failed POST validates nothing and returns null, so the caller keeps the reason and lets the reviewer retry.
 */
export async function validateWithReason<T>(
  store: Pick<AiSuggestionsStore, 'validatedAbove'>,
  fieldKey: string,
  validatedLevel: number,
  reason: string,
  validate: () => Promise<T>,
): Promise<T | null> {
  if (!(await store.validatedAbove(fieldKey, validatedLevel, reason.trim()))) return null;
  return validate();
}
