/**
 * AI suggestions of a result (spec assessment/ai-suggestions, FR-4, FR-8). Mirrors the worker contract
 * the server validates its answers against: `server/src/ai-suggestions/contract/schema/ai-suggestion-view.schema.json`
 * and `ai-suggestion-event.schema.json`. Copied by hand: keep in sync when the contract is re-synced.
 */
/** Contract 2.0.0 (worker `b3d4bbf`, `x-contractVersion`). */
export const AI_CONTRACT_VERSION = '2.0.0';

/** Scored fields (Impact Area tags, IRL, IUL) carry a colour. */
export type AiScoredSignal = 'green' | 'amber' | 'red';
/** Indicative fields (result category, innovation use numbers) carry no colour and no verdict. */
export type AiSignal = AiScoredSignal | 'indicative';

export type AiValueKind = 'level' | 'category' | 'use_numbers';

/** The categories prompt 06 can suggest for `general.result_type`. */
export type AiResultCategory =
  | 'Innovation'
  | 'Knowledge Product'
  | 'Capacity Sharing for Development'
  | 'Routine Activity'
  | 'Other';

/** One user group of prompt 09 (innovation use numbers), keys exactly as the worker stores them. */
export interface AiUseNumberRow {
  /** `actors` | `organizations` | `other type` (other type = a quantitative measure such as hectares). */
  readonly user: string;
  readonly user_type: string;
  readonly user_subtype?: string | null;
  readonly quantity: number;
  readonly men?: number | null;
  readonly women?: number | null;
  readonly youth_men?: number | null;
  readonly youth_women?: number | null;
  readonly non_youth_men?: number | null;
  readonly non_youth_women?: number | null;
  readonly geolocation?: string | null;
  readonly other_quantitative_measures?: string | null;
}

export type AiUnavailableReason =
  | 'no_readable_evidence'
  | 'private_link'
  | 'model_declined'
  | 'invalid_output'
  | 'no_criteria_for_field'
  | 'no_supporting_quote'
  | 'out_of_scope_funding'
  | 'failed';

interface AvailableSuggestionBase {
  readonly status: 'available';
  readonly fieldKey: string;
  readonly suggestionId: string;
  readonly explanation: string;
  /** IRL / IUL: always present and verified. Indicative fields have none. */
  readonly evidenceQuote?: string | null;
  readonly quoteVerified: boolean;
  readonly evidenceSource: string | null;
  readonly promptVersion: string;
  readonly modelId: string;
  /** Set when one suggestion covers several catalog fields (use numbers: organizations and measures too). */
  readonly coversFieldKeys?: readonly string[] | null;
  /** Third-Party Broker only (FR-9): whether the reviewer copied the explanation, and edited it. */
  readonly copiedByReviewer?: boolean | null;
  readonly editedByReviewer?: boolean | null;
}

/** Narrowed by `valueKind`: a level (scored), a category or a list of use numbers (indicative). */
export type AvailableSuggestionView = AvailableSuggestionBase &
  (
    | {
        readonly valueKind: 'level';
        readonly signal: AiSignal;
        /** The AI's level (0–2 for Impact Area tags, 0–9 for IRL / IUL). */
        readonly suggestedValue: number;
      }
    | {
        readonly valueKind: 'category';
        readonly signal: AiSignal;
        readonly suggestedValue: AiResultCategory;
      }
    | {
        readonly valueKind: 'use_numbers';
        readonly signal: AiSignal;
        /** Empty = the evidence reports no use numbers. */
        readonly suggestedValue: readonly AiUseNumberRow[];
      }
  );

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
