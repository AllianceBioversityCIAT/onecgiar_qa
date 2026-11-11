// @akili-spec assessment/step-1-assessment
import { InvalidListQueryError } from '../users/users.errors.js';
import {
  NUMERIC_SORT_KEYS,
  WORKLIST_SORT_KEYS,
  type SortDirection,
  type WorklistSortKey,
} from './worklist.store.js';

// The worklist cursor (design 7.3, FR-7, P-20): base64url JSON
// `{ s: sort key, d: direction, v: last sort value, c: last result code }`,
// checked like `users-query.repository.ts`: alphabet first, then the shape, then
// that it belongs to the sort and direction of this request. Anything else is a
// 400 `VALIDATION_FAILED` on `cursor`.

export interface WorklistCursor {
  s: WorklistSortKey;
  d: SortDirection;
  v: string | number;
  c: number;
  /** Membership id: the tie-break of one result code held in two rounds (admin reads both). */
  i: number;
}

// A title is at most 1,000 code points (4 bytes each at worst once escaped); the
// cap keeps a forged cursor from being parsed at any length.
const MAX_CURSOR_LENGTH = 8192;
const MAX_TEXT_VALUE = 1000;

export function encodeWorklistCursor(cursor: WorklistCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeWorklistCursor(
  cursor: string,
  expected: { sort: WorklistSortKey; dir: SortDirection },
): WorklistCursor {
  const invalid = () => new InvalidListQueryError('cursor');
  if (cursor.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw invalid();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw invalid();
  }
  const { s, d, v, c, i } = parsed as Record<string, unknown>;
  if (
    typeof s !== 'string' ||
    !(WORKLIST_SORT_KEYS as readonly string[]).includes(s) ||
    (d !== 'asc' && d !== 'desc') ||
    typeof c !== 'number' ||
    !Number.isInteger(c) ||
    c < 0 ||
    typeof i !== 'number' ||
    !Number.isInteger(i) ||
    i < 0
  ) {
    throw invalid();
  }
  // A cursor made for another sort or direction is not this request's.
  if (s !== expected.sort || d !== expected.dir) throw invalid();
  const numeric = NUMERIC_SORT_KEYS.includes(s as WorklistSortKey);
  if (numeric) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) throw invalid();
  } else if (typeof v !== 'string' || Array.from(v).length > MAX_TEXT_VALUE) {
    throw invalid();
  }
  return { s: s as WorklistSortKey, d, v: v as string | number, c, i };
}
