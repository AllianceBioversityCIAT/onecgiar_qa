// @akili-spec ingestion/step-1-loads
/**
 * Port over Reporting's results feed and intake/release routes (contract
 * `qa-catalog.en.md` v1.29, § Results feed and § Intake and release). Types
 * are camelCase; the adapter maps the wire's snake_case.
 */
export const RESULTS_FEED = Symbol('RESULTS_FEED');

export interface FeedListQuery {
  phaseYear: number;
  programIds?: number[];
  resultTypeKeys?: string[];
  page?: number;
  pageSize?: number;
}

export interface FeedListItem {
  resultId: number;
  resultCode: number;
  program: { clarisaId: number; code: string };
  resultTypeKey: string;
  /** ISO-8601 UTC, or `null` for a Submitted result with no submission history. */
  submittedAt: string | null;
}

export interface FeedPage {
  phase: number;
  page: number;
  pageSize: number;
  total: number;
  breakdown: {
    byProgram: Array<{ clarisaId: number; code: string; count: number }>;
    byResultType: Array<{ key: string; count: number }>;
  };
  items: FeedListItem[];
}

export interface FeedDetailsQuery {
  phaseYear: number;
  resultIds: number[];
  fieldKeys?: string[];
}

export interface FeedDetailsResult {
  resultId: number;
  resultCode: number;
  resultTypeKey: string;
  /** Keyed by catalog field key; the shape of each value follows the catalog `type`. */
  values: Record<string, unknown>;
}

export interface FeedDetails {
  phase: number;
  catalogVersion: string;
  results: FeedDetailsResult[];
  /** `reason` is a closed list that grows additively, so it stays a string. */
  notEligible: Array<{ resultId: number; reason: string }>;
}

export interface FeedIntakeQuery {
  phaseYear: number;
  resultIds: number[];
}

export interface FeedIntake {
  phaseYear: number;
  taken: Array<{ resultId: number; resultCode: number; changed: boolean }>;
  notTaken: Array<{
    resultId: number;
    resultCode: number | null;
    reason: string;
  }>;
}

export type ReleaseOutcome = 'qaed' | 'not_qaed';

export interface FeedReleaseQuery {
  phaseYear: number;
  items: Array<{ resultId: number; outcome: ReleaseOutcome }>;
}

export interface FeedRelease {
  phaseYear: number;
  released: Array<{
    resultId: number;
    resultCode: number;
    outcome: ReleaseOutcome;
  }>;
  notReleased: Array<{
    resultId: number;
    resultCode: number | null;
    reason: string;
  }>;
}

export interface ResultsFeed {
  list(query: FeedListQuery): Promise<FeedPage>;
  details(query: FeedDetailsQuery): Promise<FeedDetails>;
  intake(query: FeedIntakeQuery): Promise<FeedIntake>;
  release(query: FeedReleaseQuery): Promise<FeedRelease>;
}

/**
 * `unauthorized`: 401. `rejected`: any other 4xx (with its `status`).
 * `unavailable`: 5xx, timeout, network failure or a body that is not the
 * contract's shape. The message is fixed text: never a body, URL or header.
 */
export type FeedErrorKind = 'unauthorized' | 'rejected' | 'unavailable';

export class FeedError extends Error {
  constructor(
    readonly kind: FeedErrorKind,
    readonly status?: number,
  ) {
    super(`reporting_feed_${kind}${status === undefined ? '' : `_${status}`}`);
    this.name = 'FeedError';
  }
}
