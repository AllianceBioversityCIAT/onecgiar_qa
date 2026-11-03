import { describeChange, effective, rowVm, toEdit } from './fields-config';

describe('fields-config', () => {
  it('describes a state change with the flags it turns on', () => {
    const hidden = { state: 'hidden' as const, core: false, ai: false };
    expect(describeChange(hidden, { state: 'assessed', core: true, ai: false })).toBe('Assessed, was Hidden; Core on');
    expect(describeChange({ state: 'assessed', core: true, ai: true }, effective({ state: 'view_only', core: true, ai: true }))).toBe(
      'View only, was Assessed',
    );
    expect(describeChange({ state: 'assessed', core: false, ai: false }, { state: 'assessed', core: true, ai: false })).toBe('Core turned on');
  });

  it('sends Core and AI only with an assessed field (S-14)', () => {
    expect(toEdit('t', 'f', { state: 'view_only', core: true, ai: true })).toEqual({
      resultTypeKey: 't',
      fieldKey: 'f',
      visibility: 'view_only',
      isCore: false,
      isAiInput: false,
    });
    expect(effective({ state: 'assessed', core: true, ai: false }).core).toBe(true);
  });

  it('a never published field counts as hidden, and only a required field warns when not assessed', () => {
    const base = { key: 'k', label: 'K', isNew: false, unclassified: true, draft: { visibility: 'hidden' as const, isCore: false, isAiInput: false }, published: null };
    const required = rowVm({ ...base, requirement: 'required' }, { state: 'hidden', core: false, ai: false }, true);
    expect(required.changed).toBe(false);
    expect(required.requiredHidden).toBe(true);
    expect(required.notSet).toBe(true);
    const conditional = rowVm({ ...base, requirement: 'conditional' }, { state: 'hidden', core: false, ai: false }, true);
    expect(conditional.requiredHidden).toBe(false);
    expect(conditional.conditional).toBe(true);
  });
});
