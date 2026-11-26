// @akili-spec bugfix/catalog-visible-when
import { describe, expect, it } from 'vitest';
import { isVisible } from './visible-when.js';

describe('isVisible (F-015)', () => {
  const principal = {
    field: 'general.gender_tag',
    operator: 'eq',
    value: 3,
  } as const;

  it('is visible with no condition', () => {
    expect(isVisible(undefined, 'policy_change', {})).toBe(true);
  });

  it('matches the snapshot string "3" against the catalog number 3, and hides "2"', () => {
    expect(
      isVisible(principal, 'policy_change', { 'general.gender_tag': '3' }),
    ).toBe(true);
    expect(
      isVisible(principal, 'policy_change', { 'general.gender_tag': 3 }),
    ).toBe(true);
    expect(
      isVisible(principal, 'policy_change', { 'general.gender_tag': '2' }),
    ).toBe(false);
    expect(
      isVisible(principal, 'policy_change', { 'general.gender_tag': null }),
    ).toBe(false);
  });

  it('fails open on a field the snapshot lacks or a value that is not a scalar', () => {
    expect(isVisible(principal, 'policy_change', {})).toBe(true);
    expect(
      isVisible(principal, 'policy_change', { 'general.gender_tag': ['3'] }),
    ).toBe(true);
  });

  it('reads booleans as booleans, "true" and 1 included', () => {
    const c = {
      field: 'linked.has_innovation_link',
      operator: 'eq',
      value: true,
    } as const;
    expect(isVisible(c, 'x', { 'linked.has_innovation_link': true })).toBe(
      true,
    );
    expect(isVisible(c, 'x', { 'linked.has_innovation_link': 'true' })).toBe(
      true,
    );
    expect(isVisible(c, 'x', { 'linked.has_innovation_link': 1 })).toBe(true);
    expect(isVisible(c, 'x', { 'linked.has_innovation_link': false })).toBe(
      false,
    );
  });

  it('judges in, $result_type, any and all', () => {
    const scope = {
      field: 'geo.scope',
      operator: 'in',
      value: [1, 2],
    } as const;
    const type = {
      field: '$result_type',
      operator: 'eq',
      value: 'policy_change',
    } as const;
    expect(isVisible(scope, 'x', { 'geo.scope': '2' })).toBe(true);
    expect(isVisible(scope, 'x', { 'geo.scope': '3' })).toBe(false);
    expect(isVisible(type, 'policy_change', {})).toBe(true);
    expect(isVisible(type, 'other_output', {})).toBe(false);
    expect(
      isVisible({ any: [scope, type] }, 'other_output', { 'geo.scope': 9 }),
    ).toBe(false);
    expect(
      isVisible({ any: [scope, type] }, 'policy_change', { 'geo.scope': 9 }),
    ).toBe(true);
    expect(
      isVisible({ all: [scope, type] }, 'policy_change', { 'geo.scope': 9 }),
    ).toBe(false);
  });
});
