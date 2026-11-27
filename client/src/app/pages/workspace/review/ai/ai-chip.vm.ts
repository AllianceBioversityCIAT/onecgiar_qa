import {
  AI_LEVEL_FIELDS,
  AiScoredSignal,
  AiSignal,
  AiSuggestionView,
  AiUnavailableReason,
  AiUseNumberRow,
  AvailableSuggestionView,
} from '../../../../core/api/ai-suggestions.models';

/** One reported use-number row, from the Review page's field values (`reportedUseRows`). */
export interface ReportedUseRow {
  readonly group: 'actors' | 'organizations' | 'measures';
  readonly type: string;
  readonly quantity: number | null;
}

/** One AI-suggested use-number row, ready to read. */
export interface SuggestedUseRow {
  /** "Actors", "Organizations" or "Measures". */
  readonly group: string;
  /** The actor or institution type (with its subtype), or the unit of a measure. */
  readonly type: string;
  readonly quantity: number;
  /** e.g. "women 700 · men 500 · Kenya"; empty when the AI gave no breakdown. */
  readonly detail: string;
}

/**
 * What the Review page knows of the reported value of an indicative field: the reported category label
 * (`general.result_type`), or the reported use-number rows (`innovation_use.current_use.*`). Optional.
 */
export type AiReported = string | readonly ReportedUseRow[] | null;

/** The indicative part of a chip (no colour, no verdict). */
export type AiIndicativeVm =
  | { readonly kind: 'category'; readonly suggested: string; readonly reported: string | null }
  | {
      readonly kind: 'use_numbers';
      readonly suggested: readonly SuggestedUseRow[];
      readonly reported: readonly ReportedUseRow[];
      /** "This suggestion covers actors, organizations and measures." */
      readonly covers: string;
    };

/** What the AI chip of one field shows (spec assessment/ai-suggestions, FR-6). Built only by `toAiChipVm`. */
export type AiChipVm =
  | {
      readonly kind: 'available';
      readonly fieldKey: string;
      readonly suggestionId: string;
      readonly signal: AiSignal;
      /**
       * Green "Looks consistent", amber "Check", red "Review"; indicative "Indicative".
       * Never "Incorrect": the decision is the reviewer's.
       */
      readonly label: string;
      /** Indicative fields (result category, use numbers): what the AI suggests, beside what was reported. */
      readonly indicative: AiIndicativeVm | null;
      /** Indicative: the plain-words note at the bottom of the chip; null for scored fields. */
      readonly meta: string | null;
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
  // The chip already says "AI suggestion" in its header: the badge only adds the kind (Juanpa, 2026-11-25).
  indicative: 'Indicative',
};

export const AI_NO_USE_NUMBERS = 'The evidence reports no use numbers.';
export const AI_USE_NUMBERS_COVERS = 'This suggestion covers actors, organizations and measures.';
/** Meta line of every indicative chip (back lead's wording). */
export const AI_INDICATIVE_META = 'Only a suggestion';

const USE_GROUP_LABELS: Readonly<Record<string, string>> = {
  actors: 'Actors',
  organizations: 'Organizations',
  'other type': 'Measures',
};

/** The colour of a scored chip; null for an indicative one. */
export function scoredSignal(signal: AiSignal): AiScoredSignal | null {
  return signal === 'indicative' ? null : signal;
}

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

export function toAiChipVm(view: AiSuggestionView, reported: AiReported = null): AiChipVm {
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
      return availableVm(view, reported);
  }
}

function availableVm(view: AvailableSuggestionView, reported: AiReported): AiChipVm {
  if (view.valueKind !== 'level' || view.signal === 'indicative') {
    return indicativeVm(view, reported);
  }
  const level = isLevelField(view.fieldKey);
  const rawQuote = view.evidenceQuote ?? '';
  const quote = level && view.quoteVerified && rawQuote.trim() !== '' ? rawQuote : null;
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
    indicative: null,
    meta: null,
    headline: level ? `Evidence explicitly supports level ${view.suggestedValue}` : null,
    explanation: view.explanation,
    quote,
    source: view.evidenceSource,
    reviewerMark: reviewerMark(view),
  };
}

/** Result category and use numbers: a neutral chip, no colour and no verdict (contract 2.0.0). */
function indicativeVm(view: AvailableSuggestionView, reported: AiReported): AiChipVm {
  const rawQuote = view.evidenceQuote ?? '';
  return {
    kind: 'available',
    fieldKey: view.fieldKey,
    suggestionId: view.suggestionId,
    signal: 'indicative',
    label: AI_SIGNAL_LABELS.indicative,
    indicative: indicativePart(view, reported),
    meta: AI_INDICATIVE_META,
    headline: null,
    explanation: view.explanation,
    quote: rawQuote.trim() === '' ? null : rawQuote,
    source: view.evidenceSource,
    reviewerMark: reviewerMark(view),
  };
}

function indicativePart(
  view: AvailableSuggestionView,
  reported: AiReported,
): AiIndicativeVm | null {
  switch (view.valueKind) {
    case 'category':
      return {
        kind: 'category',
        suggested: view.suggestedValue,
        reported: typeof reported === 'string' && reported.trim() !== '' ? reported : null,
      };
    case 'use_numbers':
      return {
        kind: 'use_numbers',
        suggested: (Array.isArray(view.suggestedValue) ? view.suggestedValue : []).map(
          suggestedRow,
        ),
        reported: Array.isArray(reported) ? (reported as readonly ReportedUseRow[]) : [],
        covers: AI_USE_NUMBERS_COVERS,
      };
    default:
      return null;
  }
}

function suggestedRow(row: AiUseNumberRow): SuggestedUseRow {
  const type = [row.user_type, row.user_subtype]
    .filter((t) => typeof t === 'string' && t !== '')
    .join(' — ');
  const parts: string[] = [];
  const add = (label: string, value: number | null | undefined) => {
    if (typeof value === 'number') parts.push(`${label} ${formatNumber(value)}`);
  };
  add('women', row.women);
  add('men', row.men);
  add('young women', row.youth_women);
  add('young men', row.youth_men);
  add('non-young women', row.non_youth_women);
  add('non-young men', row.non_youth_men);
  if (row.geolocation) parts.push(row.geolocation);
  if (row.other_quantitative_measures) parts.push(row.other_quantitative_measures);
  return {
    group: USE_GROUP_LABELS[row.user] ?? row.user,
    type,
    quantity: row.quantity,
    detail: parts.join(' · '),
  };
}

export function formatNumber(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/**
 * What "Copy to comment" puts in the comment box: the explanation, plus one plain line with the suggested
 * numbers for use numbers. The reviewer edits it before saving (FR-7).
 */
export function copyTextOf(view: AvailableSuggestionView): string {
  if (view.valueKind === 'use_numbers' && Array.isArray(view.suggestedValue)) {
    const rows = view.suggestedValue.map(suggestedRow);
    const line =
      rows.length === 0
        ? AI_NO_USE_NUMBERS
        : `AI-suggested use numbers: ${rows.map((r) => `${formatNumber(r.quantity)} ${r.type}`).join('; ')}.`;
    return `${view.explanation}\n${line}`;
  }
  return view.explanation;
}

/**
 * Best effort: the reported use numbers from the Review page's values of `innovation_use.current_use.actors`,
 * `.organizations` and `.measures` (shapes as Reporting sends them) and their labels (id → name). An unknown
 * shape gives no row; it never throws.
 */
export function reportedUseRows(
  values:
    | {
        readonly actors?: unknown;
        readonly organizations?: unknown;
        readonly measures?: unknown;
      }
    | null
    | undefined,
  labels: Readonly<Record<string, string>> = {},
): ReportedUseRow[] {
  if (values === null || typeof values !== 'object') return [];
  const rows: ReportedUseRow[] = [];
  const list = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v)
      ? v.filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object')
      : [];
  const num = (...vs: unknown[]): number | null => {
    for (const v of vs) {
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
    }
    return null;
  };
  const name = (id: unknown, ...fallbacks: unknown[]): string => {
    if ((typeof id === 'number' || typeof id === 'string') && labels[String(id)])
      return labels[String(id)];
    for (const f of fallbacks) if (typeof f === 'string' && f.trim() !== '') return f;
    return id === undefined || id === null ? 'Not specified' : `Type ${String(id)}`;
  };
  try {
    for (const a of list(values.actors)) {
      rows.push({
        group: 'actors',
        type: name(a['actor_type'], a['other_actor_type'], a['actor_type_name']),
        quantity: num(a['how_many'], a['quantity']),
      });
    }
    for (const o of list(values.organizations)) {
      rows.push({
        group: 'organizations',
        type: name(
          o['institution_type'] ?? o['organization_type'],
          o['other_institution'],
          o['institution_type_name'],
          o['organization_type_name'],
        ),
        quantity: num(o['how_many'], o['quantity']),
      });
    }
    for (const m of list(values.measures)) {
      rows.push({
        group: 'measures',
        type: name(undefined, m['unit_of_measure'], m['unit']),
        quantity: num(m['quantity']),
      });
    }
  } catch {
    return [];
  }
  return rows;
}

function reviewerMark(view: AvailableSuggestionView): string | null {
  if (view.copiedByReviewer !== true) return null;
  return view.editedByReviewer === true ? 'Copied and edited' : 'Copied by the reviewer';
}
