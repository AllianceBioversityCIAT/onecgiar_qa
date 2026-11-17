// @akili-spec assessment/step-1-assessment
import { describe, expect, it } from 'vitest';
import {
  buildValueCopy,
  storedLength,
  VALUE_COPY_MAX_BYTES,
} from './comment-value-copy.js';

// The value copy of a comment (design 7.7, DD-8, NFR-7, FR-11 *Value at the
// time of writing*): pure. The expected values are written out.

const own = (values: Record<string, unknown>, extra = {}) => ({
  values,
  labels: undefined,
  fieldKey: 'general.title',
  controlLists: [] as string[],
  ...extra,
});

describe('what is copied', () => {
  it('copies the value, and only the labels of the lists the field names', () => {
    const copy = buildValueCopy({
      values: { 'general.primary_program': 3 },
      labels: { initiatives: { '3': 'SP03 Apple' }, centers: { '1': 'X' } },
      fieldKey: 'general.primary_program',
      controlLists: ['initiatives'],
    });
    expect(copy).toEqual({
      valueCopy: {
        value: 3,
        labels: { initiatives: { '3': 'SP03 Apple' } },
      },
      truncated: false,
    });
  });

  it('leaves every other field out: a sibling key of the values and its labels never reach the copy', () => {
    const copy = buildValueCopy({
      values: { 'general.title': 'Mine', 'general.description': 'Sibling text' },
      labels: { initiatives: { '3': 'Sibling label' } },
      fieldKey: 'general.title',
      controlLists: [],
    });
    expect(copy).toEqual({ valueCopy: { value: 'Mine' }, truncated: false });
    expect(JSON.stringify(copy)).not.toContain('Sibling');
  });

  it('keeps a null label as it is (an id with no row is shown as the id)', () => {
    const copy = buildValueCopy({
      values: { f: [1] },
      labels: { list: { '1': null } },
      fieldKey: 'f',
      controlLists: ['list'],
    });
    expect(copy.valueCopy).toEqual({ value: [1], labels: { list: { '1': null } } });
  });

  it('has no labels key when the snapshot had none: the ids stay', () => {
    const copy = buildValueCopy({
      values: { 'general.primary_program': 3 },
      labels: undefined,
      fieldKey: 'general.primary_program',
      controlLists: ['initiatives'],
    });
    expect(copy.valueCopy).toEqual({ value: 3 });
    expect(Object.hasOwn(copy.valueCopy, 'labels')).toBe(false);
  });

  it('has no labels key when none of the field lists is in the snapshot labels', () => {
    const copy = buildValueCopy({
      values: { f: 3 },
      labels: { centers: { '1': 'X' } },
      fieldKey: 'f',
      controlLists: ['initiatives'],
    });
    expect(copy.valueCopy).toEqual({ value: 3 });
  });

  it('copies null for a field the snapshot lacks, with no labels', () => {
    const copy = buildValueCopy({
      values: {},
      labels: { initiatives: { '3': 'SP03 Apple' } },
      fieldKey: 'f',
      controlLists: ['initiatives'],
    });
    expect(copy).toEqual({ valueCopy: { value: null }, truncated: false });
  });

  it('copies an own null value as null (the key is present)', () => {
    expect(buildValueCopy(own({ 'general.title': null })).valueCopy).toEqual({
      value: null,
    });
  });
});

describe('NFR-7: the 64 KiB cut', () => {
  it('measures the stored length the way MySQL writes JSON text: a space after every colon and comma', () => {
    expect(storedLength({ value: [1, 2] })).toBe('{"value": [1, 2]}'.length);
    expect(storedLength({ value: { a: 'é' } })).toBe(
      Buffer.byteLength('{"value": {"a": "é"}}'),
    );
  });

  it('keeps a copy of exactly 65,536 bytes whole, and cuts one byte more', () => {
    const overhead = storedLength({ value: '' });
    const fits = 'a'.repeat(VALUE_COPY_MAX_BYTES - overhead);
    expect(buildValueCopy(own({ 'general.title': fits }))).toEqual({
      valueCopy: { value: fits },
      truncated: false,
    });
    const over = buildValueCopy(own({ 'general.title': `${fits}a` }));
    expect(over.truncated).toBe(true);
    expect((over.valueCopy.value as string).length).toBe(fits.length);
  });

  it('cuts a long string to a prefix of itself that fits, and sets the flag', () => {
    const long = 'x'.repeat(200_000);
    const { valueCopy, truncated } = buildValueCopy(
      own({ 'general.title': long }),
    );
    expect(truncated).toBe(true);
    expect(storedLength(valueCopy)).toBeLessThanOrEqual(VALUE_COPY_MAX_BYTES);
    expect(long.startsWith(valueCopy.value as string)).toBe(true);
    expect((valueCopy.value as string).length).toBeGreaterThan(65_000);
  });

  it('never cuts inside a character: a 4-byte emoji at the boundary is kept or dropped whole', () => {
    const emoji = '😀'.repeat(40_000);
    const { valueCopy } = buildValueCopy(own({ 'general.title': emoji }));
    const kept = valueCopy.value as string;
    // No lone surrogate: the cut never lands inside a character.
    expect(kept).not.toMatch(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/,
    );
    expect(emoji.startsWith(kept)).toBe(true);
    expect(storedLength(valueCopy)).toBeLessThanOrEqual(VALUE_COPY_MAX_BYTES);
    // The next emoji would not have fit.
    expect(storedLength({ value: `${kept}😀` })).toBeGreaterThan(
      VALUE_COPY_MAX_BYTES,
    );
  });

  it('cuts an array to its leading elements', () => {
    const rows = Array.from({ length: 20_000 }, (_, i) => `row-${i}`);
    const { valueCopy, truncated } = buildValueCopy(own({ 'general.title': rows }));
    const kept = valueCopy.value as string[];
    expect(truncated).toBe(true);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(rows.length);
    expect(kept).toEqual(rows.slice(0, kept.length));
    expect(storedLength(valueCopy)).toBeLessThanOrEqual(VALUE_COPY_MAX_BYTES);
    expect(storedLength({ value: rows.slice(0, kept.length + 1) })).toBeGreaterThan(
      VALUE_COPY_MAX_BYTES,
    );
  });

  it('cuts an object to its leading keys', () => {
    const big = Object.fromEntries(
      Array.from({ length: 20_000 }, (_, i) => [`k${i}`, `v${i}`]),
    );
    const { valueCopy, truncated } = buildValueCopy(own({ 'general.title': big }));
    expect(truncated).toBe(true);
    const kept = valueCopy.value as Record<string, string>;
    const keys = Object.keys(kept);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys).toEqual(Object.keys(big).slice(0, keys.length));
    expect(storedLength(valueCopy)).toBeLessThanOrEqual(VALUE_COPY_MAX_BYTES);
  });

  it('drops the labels first: a value that fits alone keeps its whole value and loses the labels', () => {
    const value = 'v'.repeat(60_000);
    const labels = { list: { '1': 'L'.repeat(10_000) } };
    const { valueCopy, truncated } = buildValueCopy({
      values: { f: value },
      labels,
      fieldKey: 'f',
      controlLists: ['list'],
    });
    expect(truncated).toBe(true);
    expect(valueCopy).toEqual({ value });
  });

  it('does not set the flag for a small value with small labels', () => {
    expect(
      buildValueCopy({
        values: { f: 'a' },
        labels: { list: { '1': 'one' } },
        fieldKey: 'f',
        controlLists: ['list'],
      }).truncated,
    ).toBe(false);
  });
});
