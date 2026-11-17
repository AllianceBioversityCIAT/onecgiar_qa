import {
  AI_LEVEL_FIELDS,
  AiSignal,
  AiSuggestionView,
  AiUnavailableReason,
  AvailableSuggestionView,
} from '../../../../core/api/ai-suggestions.models';

/** What the AI chip of one field shows (spec assessment/ai-suggestions, FR-6). Built only by `toAiChipVm`. */
export type AiChipVm =
  | {
      readonly kind: 'available';
      readonly fieldKey: string;
      readonly suggestionId: string;
      readonly signal: AiSignal;
      /** Green "Looks consistent", amber "Check", red "Review". Never "Incorrect": the decision is the reviewer's. */
      readonly label: string;
      /** IRL / IUL: "Evidence explicitly supports level X" (only with a verified quote); null for the Impact Area tags. */
      readonly headline: string | null;
      readonly explanation: string;
      /** The verified quote of the evidence (IRL / IUL), else null. */
      readonly quote: string | null;
      readonly source: string | null;
      /** Third-Party Broker only: "Copied by the reviewer" / "Copied and edited"; null otherwise. */
      readonly reviewerMark: string | null;
    }
  | {
      readonly kind: 'unavailable';
      readonly fieldKey: string;
      readonly label: string;
      readonly reason: string;
    }
  | { readonly kind: 'pending'; readonly fieldKey: string; readonly label: string };

export const AI_SIGNAL_LABELS: Readonly<Record<AiSignal, string>> = {
  green: 'Looks consistent',
  amber: 'Check',
  red: 'Review',
};

export const AI_NOT_AVAILABLE = 'Suggestion not available';
export const AI_PENDING = 'Suggestion in progress';

/** Plain-English reason per code (FR-6, AC8). The field stays fully assessable in every case. */
export const AI_UNAVAILABLE_REASONS: Readonly<Record<AiUnavailableReason, string>> = {
  no_readable_evidence: 'None of the evidence links could be read.',
  private_link: 'The evidence links are private or need a login.',
  model_declined: 'The AI could not judge this field.',
  invalid_output: 'The AI answer could not be used.',
  no_criteria_for_field: 'There are no AI criteria for this field yet.',
  no_supporting_quote: 'No quote in the evidence supports a level.',
  out_of_scope_funding: 'AI suggestions cover pooled-funding results only.',
  failed: 'The AI could not finish this field. It can be requested again.',
};

/** Shown when the suggestions could not be read at all (request failed): the page degrades, never blocks. */
export const AI_READ_FAILED_REASON = 'The AI suggestions could not be loaded.';

export function isLevelField(fieldKey: string): boolean {
  return AI_LEVEL_FIELDS.includes(fieldKey);
}

export function toAiChipVm(view: AiSuggestionView): AiChipVm {
  switch (view.status) {
    case 'pending':
      return { kind: 'pending', fieldKey: view.fieldKey, label: AI_PENDING };
    case 'unavailable':
      return {
        kind: 'unavailable',
        fieldKey: view.fieldKey,
        label: AI_NOT_AVAILABLE,
        reason: AI_UNAVAILABLE_REASONS[view.unavailableReason] ?? AI_READ_FAILED_REASON,
      };
    case 'available':
      return availableVm(view);
  }
}

function availableVm(view: AvailableSuggestionView): AiChipVm {
  const level = isLevelField(view.fieldKey);
  const quote =
    level && view.quoteVerified && view.evidenceQuote.trim() !== '' ? view.evidenceQuote : null;
  // IRL / IUL are shown only as "Evidence explicitly supports level X" with its quote (MG's pilot decision).
  // The worker stores a level without a verified quote as unavailable; a stray one is treated the same here.
  if (level && quote === null) {
    return {
      kind: 'unavailable',
      fieldKey: view.fieldKey,
      label: AI_NOT_AVAILABLE,
      reason: AI_UNAVAILABLE_REASONS.no_supporting_quote,
    };
  }
  return {
    kind: 'available',
    fieldKey: view.fieldKey,
    suggestionId: view.suggestionId,
    signal: view.signal,
    label: AI_SIGNAL_LABELS[view.signal],
    headline: level ? `Evidence explicitly supports level ${view.suggestedValue}` : null,
    explanation: view.explanation,
    quote,
    source: view.evidenceSource,
    reviewerMark: reviewerMark(view),
  };
}

function reviewerMark(view: AvailableSuggestionView): string | null {
  if (view.copiedByReviewer !== true) return null;
  return view.editedByReviewer === true ? 'Copied and edited' : 'Copied by the reviewer';
}
