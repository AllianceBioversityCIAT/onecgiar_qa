// @akili-spec assessment/step-1-assessment
import type { CommentValueCopy } from '../database/drizzle/schema/assessment-comments.js';
import { labelsForField, type ViewLabels } from './assessment-view.js';

// The value copy of a comment (design 7.7, DD-8, NFR-7, FR-11 *Value at the
// time of writing*): `{ value, labels? }` of the field as ONE membership's
// snapshot holds it, cut to fit the `chk_value_copy_size` check. Pure: no store,
// no clock, no HTTP error.

/** 64 KiB, the limit of `chk_value_copy_size` (`LENGTH(value_copy) <= 65536`). */
export const VALUE_COPY_MAX_BYTES = 65536;

/**
 * The JSON text MySQL gives back for a value, which is what `LENGTH()` measures:
 * a space after every `:` and `,` (`{"a": 1, "b": [1, 2]}`), so it is longer
 * than `JSON.stringify`. Measuring with the compact form would let a copy of
 * many small elements pass here and fail the check in the database.
 */
function mysqlJsonText(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => mysqlJsonText(item)).join(', ')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => `${JSON.stringify(key)}: ${mysqlJsonText(item)}`)
      .join(', ')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** The bytes the copy takes in the `value_copy` column (UTF-8 of its JSON text). */
export function storedLength(copy: CommentValueCopy): number {
  return Buffer.byteLength(mysqlJsonText(copy));
}

/** The largest prefix of `size` units for which `fits` holds (`fits` is monotonic: a shorter prefix always fits when a longer one does). */
function largestFitting(size: number, fits: (length: number) => boolean) {
  let low = 0;
  let high = size;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle)) low = middle;
    else high = middle - 1;
  }
  return low;
}

/**
 * The value cut to the longest leading part that still fits alone: a string
 * to a prefix of whole characters (never inside a surrogate pair), an array to
 * its leading elements, an object to its leading keys. A scalar cannot be over.
 */
function cutValue(value: unknown): unknown {
  const fits = (candidate: unknown) =>
    storedLength({ value: candidate }) <= VALUE_COPY_MAX_BYTES;
  if (typeof value === 'string') {
    const characters = Array.from(value);
    return characters
      .slice(
        0,
        largestFitting(characters.length, (n) =>
          fits(characters.slice(0, n).join('')),
        ),
      )
      .join('');
  }
  if (Array.isArray(value)) {
    return value.slice(
      0,
      largestFitting(value.length, (n) => fits(value.slice(0, n))),
    );
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);
    return Object.fromEntries(
      entries.slice(
        0,
        largestFitting(entries.length, (n) =>
          fits(Object.fromEntries(entries.slice(0, n))),
        ),
      ),
    );
  }
  return value;
}

export interface ValueCopyInput {
  /** The membership's own snapshot values (never the result's latest snapshot). */
  values: Readonly<Record<string, unknown>>;
  /** That snapshot's labels, by control list. */
  labels: Readonly<ViewLabels> | undefined;
  fieldKey: string;
  /** The lists the field's catalog row names (its own and its subfields'). */
  controlLists: readonly string[];
}

export interface ValueCopy {
  valueCopy: CommentValueCopy;
  /** `true` when the copy was cut to fit the limit. */
  truncated: boolean;
}

/**
 * The copy a comment stores. A field the snapshot lacks copies `null`, with no
 * labels (the view shows it "Not applicable"). Labels are the ones of the lists
 * the field names; with none in the snapshot the copy has no `labels` key and
 * the ids stay. Over the limit the labels go first, and when the value alone is
 * still too long it is cut (`truncated`); the snapshot stays the full source.
 */
export function buildValueCopy(input: ValueCopyInput): ValueCopy {
  const present = Object.hasOwn(input.values, input.fieldKey);
  const value = present ? input.values[input.fieldKey] : null;
  const labels = present
    ? labelsForField(input.labels, input.controlLists)
    : null;

  const whole: CommentValueCopy =
    labels === null ? { value } : { value, labels };
  if (storedLength(whole) <= VALUE_COPY_MAX_BYTES) {
    return { valueCopy: whole, truncated: false };
  }
  const alone: CommentValueCopy = { value };
  if (storedLength(alone) <= VALUE_COPY_MAX_BYTES) {
    return { valueCopy: alone, truncated: true };
  }
  return { valueCopy: { value: cutValue(value) }, truncated: true };
}
