// @akili-spec bugfix/catalog-visible-when
import type { VisibleWhen } from './field-config-catalog.js';

// Reporting's `visible_when` judged on a result's snapshot values (F-015).
// Pure. Fails open: a condition that reads a field the snapshot lacks, or a
// value that is not a scalar, counts as met, so a field is only ever hidden on
// a value that is actually there and says so.

/** The key that names the result type instead of a field. */
export const RESULT_TYPE_KEY = '$result_type';

/** Reporting sends ids as numbers in the catalog and as strings in snapshots. */
function same(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (typeof expected === 'boolean') {
    return String(actual) === String(expected) || actual === (expected ? 1 : 0);
  }
  if (typeof expected === 'number') {
    return (
      typeof actual === 'string' &&
      actual.trim() !== '' &&
      Number(actual) === expected
    );
  }
  if (typeof expected === 'string') {
    return typeof actual === 'number' && String(actual) === expected;
  }
  return false;
}

const isScalar = (v: unknown): boolean =>
  v === null || ['string', 'number', 'boolean'].includes(typeof v);

/** Whether a field with this condition is shown for the result. */
export function isVisible(
  condition: VisibleWhen | undefined,
  resultType: string,
  values: Readonly<Record<string, unknown>>,
): boolean {
  if (condition === undefined) return true;
  if ('any' in condition) {
    return condition.any.some((c) => isVisible(c, resultType, values));
  }
  if ('all' in condition) {
    return condition.all.every((c) => isVisible(c, resultType, values));
  }
  let actual: unknown;
  if (condition.field === RESULT_TYPE_KEY) {
    actual = resultType;
  } else {
    if (!Object.hasOwn(values, condition.field)) return true;
    actual = values[condition.field];
    if (!isScalar(actual)) return true;
  }
  return condition.operator === 'eq'
    ? same(actual, condition.value)
    : condition.value.some((v) => same(actual, v));
}
