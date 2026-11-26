// @akili-spec assessment/ai-suggestions
import type { AiSuggestionItem } from '../ai-suggestions/ai-suggestion.store.js';
import {
  AI_LEVEL_FIELDS,
  productionFieldOf,
} from '../ai-suggestions/ai-config.js';
import type { AiValueKind } from '../ai-suggestions/production-contract.js';
import { RoleCode } from '../users/permissions.js';
import {
  effectiveRow,
  type MembershipFacts,
  type WorklistAccess,
} from './scope.js';

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

export function aiAudienceOf(
  access: WorklistAccess,
  facts?: MembershipFacts,
): AiAudience {
  // DD-T11: on a membership, only the caller's effective role counts (a Lead
  // who is also TPB gets the TPB mode once the result is pending_tpb_review).
  const effective =
    facts === undefined ? undefined : effectiveRow(access, facts);
  const roles =
    facts === undefined
      ? access.reviewerRows.map((row) => row.role)
      : effective === undefined
        ? []
        : [effective.role];
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

/** Contract 2.0.0: scored fields are green/amber/red, indicative fields `indicative` (no colour). */
export const AI_SIGNALS = ['green', 'amber', 'red', 'indicative'] as const;
export type AiSignalValue = (typeof AI_SIGNALS)[number];
const SCORED_SIGNALS: readonly string[] = ['green', 'amber', 'red'];

/** `general.result_type` suggestions (contract 2.0.0, ResultCategory). */
export const AI_RESULT_CATEGORIES = [
  'Innovation',
  'Knowledge Product',
  'Capacity Sharing for Development',
  'Routine Activity',
  'Other',
] as const;
export type AiResultCategory = (typeof AI_RESULT_CATEGORIES)[number];

/** UseNumberRow keys (contract 2.0.0): all present in the view, nullable ones as null. */
export const AI_USE_NUMBER_KEYS = [
  'user',
  'user_type',
  'user_subtype',
  'quantity',
  'women',
  'youth_women',
  'non_youth_women',
  'men',
  'youth_men',
  'non_youth_men',
  'geolocation',
  'other_quantitative_measures',
] as const;

/** One user group of prompt 09 (UseNumberRow), as the view sends it. */
export type AiUseNumberRow = Record<
  (typeof AI_USE_NUMBER_KEYS)[number],
  unknown
> & {
  user: string;
  user_type: string;
  quantity: number;
};

/**
 * The view row: exactly the schema's 12 keys, a missing nullable one as null
 * and an unknown one dropped (`additionalProperties: false`), so a row the
 * worker stored without its null keys is still schema-valid.
 */
export const toUseNumberRow = (row: AiUseNumberRow): AiUseNumberRow =>
  Object.fromEntries(
    AI_USE_NUMBER_KEYS.map((key) => [key, row[key] ?? null]),
  ) as AiUseNumberRow;

export type AiSuggestedValue = number | AiResultCategory | AiUseNumberRow[];

/** `ai-suggestion-view.schema.json`, field for field (no other key). */
export type AiSuggestionView =
  | {
      status: 'available';
      fieldKey: string;
      suggestionId: string;
      signal: AiSignalValue;
      valueKind: AiValueKind;
      suggestedValue: AiSuggestedValue;
      explanation: string;
      /** Scored fields only; indicative fields have none (null). */
      evidenceQuote: string | null;
      quoteVerified: boolean;
      evidenceSource: string | null;
      promptVersion: string;
      modelId: string;
      /** Set when one suggestion covers several catalog fields (innovation use numbers). */
      coversFieldKeys?: string[];
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

const isUseNumberRow = (row: unknown): row is AiUseNumberRow =>
  typeof row === 'object' &&
  row !== null &&
  typeof (row as { user?: unknown }).user === 'string' &&
  typeof (row as { user_type?: unknown }).user_type === 'string' &&
  typeof (row as { quantity?: unknown }).quantity === 'number';

/**
 * The value kind of an item: the stored one, else production's (items written
 * before contract 2.0.0 carry none; they are all levels).
 */
const valueKindOf = (item: AiSuggestionItem): AiValueKind | undefined =>
  (item.valueKind as AiValueKind | undefined) ??
  productionFieldOf(item.fieldKey)?.valueKind;

/**
 * An `available` item whose value the view cannot show: the defect is shown as
 * `invalid_output`. The value must match its kind and the kind must be the
 * one production names for the field (contract 2.0.0): a level is an integer
 * on the field's scale with a colour; a category one of the five, `indicative`;
 * use numbers a list of user groups (empty = none reported), `indicative`.
 */
const isUsable = (item: AiSuggestionItem): boolean => {
  const production = productionFieldOf(item.fieldKey);
  const kind = valueKindOf(item);
  if (production === undefined || kind !== production.valueKind) return false;
  if (typeof item.explanation !== 'string') return false;
  const value: unknown = item.suggestedValue;
  switch (kind) {
    case 'level': {
      const min = production.scale?.min ?? 0;
      const max = production.scale?.max ?? 9;
      return (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= min &&
        value <= max &&
        SCORED_SIGNALS.includes(item.signal ?? '')
      );
    }
    case 'category':
      return (
        (AI_RESULT_CATEGORIES as readonly unknown[]).includes(value) &&
        item.signal === 'indicative'
      );
    case 'use_numbers':
      return (
        Array.isArray(value) &&
        value.every(isUseNumberRow) &&
        item.signal === 'indicative'
      );
  }
};

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
      const kind = valueKindOf(item)!;
      if (
        (kind === 'level' && typeof item.evidenceQuote !== 'string') ||
        typeof item.modelId !== 'string' ||
        typeof item.quoteVerified !== 'boolean'
      ) {
        defects.push(item.suggestionId);
      }
      const covers = Array.isArray(item.coversFieldKeys)
        ? (item.coversFieldKeys as unknown[]).filter(
            (key): key is string => typeof key === 'string',
          )
        : [];
      const mark = marks?.get(item.suggestionId);
      return {
        status: 'available',
        fieldKey,
        suggestionId: item.suggestionId,
        signal: item.signal as AiSignalValue,
        valueKind: kind,
        suggestedValue:
          kind === 'use_numbers'
            ? (item.suggestedValue as AiUseNumberRow[]).map(toUseNumberRow)
            : (item.suggestedValue as AiSuggestedValue),
        explanation: item.explanation!,
        evidenceQuote:
          typeof item.evidenceQuote === 'string' ? item.evidenceQuote : null,
        // A quote nobody verified is never shown as "Evidence explicitly supports".
        quoteVerified: item.quoteVerified === true,
        evidenceSource: item.evidenceSource ?? null,
        promptVersion: item.promptVersion,
        modelId: item.modelId ?? '',
        ...(covers.length > 0 ? { coversFieldKeys: covers } : {}),
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
