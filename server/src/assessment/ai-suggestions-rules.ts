// @akili-spec assessment/ai-suggestions
import type { AiSuggestionItem } from '../ai-suggestions/ai-suggestion.store.js';
import { AI_LEVEL_FIELDS } from '../ai-suggestions/production.js';
import { RoleCode } from '../users/permissions.js';
import type { WorklistAccess } from './scope.js';

// Pure rules of the AI suggestion routes (ai-suggestions FR-4, FR-5, FR-8,
// FR-9): who sees what, the view of a stored item, and what an event must
// carry. No I/O.

/**
 * FR-5. `reviewer`: ASSESSOR or LEAD_ASSESSOR, sees everything and records
 * usage. `tpb`: read-only, with the copied/edited mark. `admin`: read-only,
 * WITHOUT the mark (OQ-2: the mark says what a reviewer did; only the TPB sees
 * it, as the story asks). `forbidden`: PPU. `none`: no row that reaches this
 * result (the same 404 as the assessment view).
 *
 * Only the ASSESSOR row of the role-step table is enabled today, so a TPB,
 * LEAD_ASSESSOR or PPU has no reviewer row yet and gets the assessment 404
 * before this decision; their branches take effect when their rows are
 * enabled (step-1-assessment `role-steps.ts`).
 */
export type AiAudience =
  | { kind: 'reviewer'; roleCode: RoleCode }
  | { kind: 'tpb' }
  | { kind: 'admin' }
  | { kind: 'forbidden' }
  | { kind: 'none' };

export function aiAudienceOf(access: WorklistAccess): AiAudience {
  const roles = access.reviewerRows.map((row) => row.role);
  const reviewer = roles.find(
    (role) => role === RoleCode.ASSESSOR || role === RoleCode.LEAD_ASSESSOR,
  );
  if (reviewer !== undefined) return { kind: 'reviewer', roleCode: reviewer };
  if (roles.includes(RoleCode.TPB)) return { kind: 'tpb' };
  if (roles.includes(RoleCode.PPU)) return { kind: 'forbidden' };
  if (access.admin) return { kind: 'admin' };
  if (access.disabledRoles.includes(RoleCode.PPU)) return { kind: 'forbidden' };
  return { kind: 'none' };
}

export const AI_UNAVAILABLE_REASONS = [
  'no_readable_evidence',
  'private_link',
  'model_declined',
  'invalid_output',
  'no_criteria_for_field',
  'no_supporting_quote',
  'out_of_scope_funding',
  'failed',
] as const;
export type AiUnavailableReason = (typeof AI_UNAVAILABLE_REASONS)[number];

export const AI_SIGNALS = ['green', 'amber', 'red'] as const;
export type AiSignalValue = (typeof AI_SIGNALS)[number];

/** `ai-suggestion-view.schema.json`, field for field (no other key). */
export type AiSuggestionView =
  | {
      status: 'available';
      fieldKey: string;
      suggestionId: string;
      signal: AiSignalValue;
      suggestedValue: number;
      explanation: string;
      evidenceQuote: string;
      quoteVerified: boolean;
      evidenceSource: string | null;
      promptVersion: string;
      modelId: string;
      copiedByReviewer?: boolean | null;
      editedByReviewer?: boolean | null;
    }
  | {
      status: 'unavailable';
      fieldKey: string;
      unavailableReason: AiUnavailableReason;
    }
  | { status: 'pending'; fieldKey: string };

/** FR-9: what the TPB sees of a reviewer's use of one suggestion. */
export interface AiUsageMark {
  copied: boolean;
  /** The last `comment_saved` of the suggestion; `null` when none. */
  edited: boolean | null;
}

/** An `available` item whose value the view cannot show: the defect is shown as `invalid_output`. */
const isUsable = (item: AiSuggestionItem): boolean =>
  typeof item.suggestedValue === 'number' &&
  Number.isInteger(item.suggestedValue) &&
  item.suggestedValue >= 0 &&
  item.suggestedValue <= 9 &&
  (AI_SIGNALS as readonly string[]).includes(item.signal ?? '') &&
  typeof item.explanation === 'string';

/**
 * FR-4: one view per eligible field, in that order. A stored `available` item
 * becomes `available` (its nullable quote, source and model mapped to the
 * schema's types), a stored `unavailable` item keeps its reason (an unknown one
 * reads `failed`), and an eligible field with nothing stored is `pending`.
 * Stored items of a field that is not eligible are not shown. `marks` is
 * given for the TPB only (FR-9); `defects` collects the suggestion ids whose
 * stored shape had to be repaired, for a log line of ids only (NFR-2).
 */
export function toSuggestionViews(
  fields: readonly string[],
  items: readonly AiSuggestionItem[],
  marks?: ReadonlyMap<string, AiUsageMark>,
  defects: string[] = [],
): AiSuggestionView[] {
  const byField = new Map(items.map((item) => [item.fieldKey, item]));
  return fields.map((fieldKey): AiSuggestionView => {
    const item = byField.get(fieldKey);
    if (item === undefined) return { status: 'pending', fieldKey };
    if (item.status === 'available') {
      if (!isUsable(item)) {
        defects.push(item.suggestionId);
        return {
          status: 'unavailable',
          fieldKey,
          unavailableReason: 'invalid_output',
        };
      }
      if (
        typeof item.evidenceQuote !== 'string' ||
        typeof item.modelId !== 'string' ||
        typeof item.quoteVerified !== 'boolean'
      ) {
        defects.push(item.suggestionId);
      }
      const mark = marks?.get(item.suggestionId);
      return {
        status: 'available',
        fieldKey,
        suggestionId: item.suggestionId,
        signal: item.signal as AiSignalValue,
        suggestedValue: item.suggestedValue!,
        explanation: item.explanation!,
        evidenceQuote: item.evidenceQuote ?? '',
        // A quote nobody verified is never shown as "Evidence explicitly supports".
        quoteVerified: item.quoteVerified === true,
        evidenceSource: item.evidenceSource ?? null,
        promptVersion: item.promptVersion,
        modelId: item.modelId ?? '',
        ...(marks === undefined
          ? {}
          : {
              copiedByReviewer: mark?.copied ?? false,
              editedByReviewer: mark?.edited ?? null,
            }),
      };
    }
    const reason = (AI_UNAVAILABLE_REASONS as readonly string[]).includes(
      item.unavailableReason ?? '',
    )
      ? (item.unavailableReason as AiUnavailableReason)
      : 'failed';
    return { status: 'unavailable', fieldKey, unavailableReason: reason };
  });
}

/** Whitespace-insensitive text, so a re-flowed copy is not "edited" (FR-8 `comment_saved`). */
export const normalizeText = (text: string): string =>
  text.trim().replace(/\s+/g, ' ');

/** FR-8: whether a saved comment differs from the explanation it was copied from. */
export const isEdited = (commentBody: string, explanation: string): boolean =>
  normalizeText(commentBody) !== normalizeText(explanation);

/** The refusal of a `validated_above_ai` event, by rule; `null` when it holds. */
export type AboveAiRefusal =
  | 'not_a_level_field'
  | 'ai_level_mismatch'
  | 'reported_level_mismatch'
  | 'difference_below_2'
  | 'reason_not_one_line';

/**
 * FR-8 `validated_above_ai`: only IRL / IUL; the AI level the client saw must
 * be the stored one, the validated level the reported one, at least 2 above,
 * and the reason one line of 1 to 200 characters. The levels are checked
 * against the stored item, never trusted from the client.
 */
export function checkAboveAi(
  item: Pick<AiSuggestionItem, 'fieldKey' | 'suggestedValue' | 'reportedValue'>,
  event: { aiLevel: number; validatedLevel: number; reason: string },
): AboveAiRefusal | null {
  if (!AI_LEVEL_FIELDS.includes(item.fieldKey)) return 'not_a_level_field';
  if (event.aiLevel !== item.suggestedValue) return 'ai_level_mismatch';
  if (event.validatedLevel !== item.reportedValue) {
    return 'reported_level_mismatch';
  }
  if (event.validatedLevel - event.aiLevel < 2) return 'difference_below_2';
  const reason = event.reason.trim();
  if (reason.length < 1 || reason.length > 200 || /[\r\n]/.test(event.reason)) {
    return 'reason_not_one_line';
  }
  return null;
}
