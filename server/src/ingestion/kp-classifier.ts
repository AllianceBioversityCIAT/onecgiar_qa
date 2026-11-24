// @akili-spec ingestion/step-1-loads
import type {
  TimelineResultKpGroup,
  TimelineResultStatus,
} from '../database/drizzle/schema/timeline-results.js';

/** DI token of the KP rule source (design 7.5); the default is `classifyResult`. */
export const KP_RULES = Symbol('KP_RULES');

export interface ResultClassificationInput {
  resultTypeKey: string;
  /** The feed `values`, keyed by catalog field key. */
  values: Record<string, unknown>;
}

export interface ResultClassification {
  status: TimelineResultStatus;
  kpGroup: TimelineResultKpGroup | null;
  /**
   * Always null: a KP to review is assessed in step 1 like any result
   * (S-9 as corrected 2026-11-04). The column stays in `0007`, unused.
   */
  awaitsStep: number | null;
}

export interface KpRules {
  classify(input: ResultClassificationInput): ResultClassification;
}

/** The feed keys of the 2025 rule (proposal 12.1). */
export const KP_RULE_KEYS = [
  'knowledge_product.is_melia',
  'knowledge_product.type',
  'knowledge_product.issue_date_cg',
  'knowledge_product.issue_date_wos',
  'knowledge_product.is_isi_cg',
  'knowledge_product.is_isi_wos',
  'knowledge_product.peer_reviewed_cg',
  'knowledge_product.peer_reviewed_wos',
  'knowledge_product.accessibility_cg',
  'knowledge_product.accessibility_wos',
] as const;

export const KP_TYPE_KEY = 'knowledge_product';
const JOURNAL_ARTICLE = 'journal article';

/** A year from a number (`2025`) or a date string (`2025-03-01`); null otherwise. */
function yearOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string') {
    const match = /^\s*(\d{4})/.exec(value);
    return match ? Number(match[1]) : null;
  }
  return null;
}

function isTrue(value: unknown): boolean {
  return value === true || value === 1;
}

function normalizedText(value: unknown): string | null {
  return typeof value === 'string' ? value.trim().toLowerCase() : null;
}

/** CGSpace's accessibility is an object `{accessibility}`; Unpaywall's is text. */
function cgAccessibility(value: unknown): unknown {
  if (value !== null && typeof value === 'object') {
    return (value as Record<string, unknown>)['accessibility'];
  }
  return value;
}

function autoChecked(values: Record<string, unknown>): boolean {
  const yearCg = yearOf(values['knowledge_product.issue_date_cg']);
  const yearWos = yearOf(values['knowledge_product.issue_date_wos']);
  const accessCg = normalizedText(
    cgAccessibility(values['knowledge_product.accessibility_cg']),
  );
  const accessWos = normalizedText(
    values['knowledge_product.accessibility_wos'],
  );
  return (
    yearCg !== null &&
    yearCg === yearWos &&
    isTrue(values['knowledge_product.is_isi_cg']) &&
    isTrue(values['knowledge_product.is_isi_wos']) &&
    isTrue(values['knowledge_product.peer_reviewed_cg']) &&
    isTrue(values['knowledge_product.peer_reviewed_wos']) &&
    accessCg !== null &&
    accessCg === accessWos
  );
}

/** The 2025 KP rule (design 7.5, FR-7); non-KP results stay `pending`. */
export function classifyResult(
  input: ResultClassificationInput,
): ResultClassification {
  if (input.resultTypeKey !== KP_TYPE_KEY) {
    return { status: 'pending', kpGroup: null, awaitsStep: null };
  }
  const { values } = input;
  const isJournal =
    normalizedText(values['knowledge_product.type']) === JOURNAL_ARTICLE;
  if (isJournal && autoChecked(values)) {
    return {
      status: 'auto_validated',
      kpGroup: 'auto_checked',
      awaitsStep: null,
    };
  }
  if (!isTrue(values['knowledge_product.is_melia']) && !isJournal) {
    return { status: 'not_in_qa', kpGroup: 'not_in_qa', awaitsStep: null };
  }
  return { status: 'pending', kpGroup: 'review', awaitsStep: null };
}

export const DEFAULT_KP_RULES: KpRules = { classify: classifyResult };
