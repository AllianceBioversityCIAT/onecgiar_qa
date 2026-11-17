/**
 * AI suggestions of a result (spec assessment/ai-suggestions, FR-4, FR-8). Mirrors the worker contract
 * the server validates its answers against: `server/src/ai-suggestions/contract/schema/ai-suggestion-view.schema.json`
 * and `ai-suggestion-event.schema.json`. Copied by hand: keep in sync when the contract is re-synced.
 */
export type AiSignal = 'green' | 'amber' | 'red';

export type AiUnavailableReason =
  | 'no_readable_evidence'
  | 'private_link'
  | 'model_declined'
  | 'invalid_output'
  | 'no_criteria_for_field'
  | 'no_supporting_quote'
  | 'out_of_scope_funding'
  | 'failed';

export interface AvailableSuggestionView {
  readonly status: 'available';
  readonly fieldKey: string;
  readonly suggestionId: string;
  readonly signal: AiSignal;
  /** The AI's level (0–2 for Impact Area tags, 0–9 for IRL / IUL). */
  readonly suggestedValue: number;
  readonly explanation: string;
  readonly evidenceQuote: string;
  readonly quoteVerified: boolean;
  readonly evidenceSource: string | null;
  readonly promptVersion: string;
  readonly modelId: string;
  /** Third-Party Broker only (FR-9): whether the reviewer copied the explanation, and edited it. */
  readonly copiedByReviewer?: boolean | null;
  readonly editedByReviewer?: boolean | null;
}

export interface UnavailableSuggestionView {
  readonly status: 'unavailable';
  readonly fieldKey: string;
  readonly unavailableReason: AiUnavailableReason;
}

export interface PendingSuggestionView {
  readonly status: 'pending';
  readonly fieldKey: string;
}

export type AiSuggestionView =
  AvailableSuggestionView | UnavailableSuggestionView | PendingSuggestionView;

export type AiUsageEvent =
  | { readonly action: 'shown' | 'copied' }
  | { readonly action: 'comment_saved'; readonly commentId: string };

/** The reviewer validated a level 2 or more above the AI's (IRL / IUL). The server re-checks every number. */
export interface AiValidatedAboveEvent {
  readonly action: 'validated_above_ai';
  readonly aiLevel: number;
  readonly validatedLevel: number;
  /** One line, 1–200 characters. */
  readonly reason: string;
}

export type AiSuggestionEvent = AiUsageEvent | AiValidatedAboveEvent;

/** IRL and IUL: the level fields of the pilot (server `AI_LEVEL_FIELDS`). */
export const AI_LEVEL_FIELDS: readonly string[] = [
  'innovation_dev.readiness_level',
  'innovation_use.use_level.innovation_use_level',
];
