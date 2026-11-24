import { describe, expect, it } from 'vitest';
import type { ConfigItem } from './field-config-diff.js';
import { withLiveVisibility } from './live-visibility.js';

// F-005 (MG testing log, 2026-11-23): a started timeline keeps the version it
// resolved to (S-13) and an assessment keeps the version it pinned (DD-3), but a
// change between Hidden and View only in the cycle's LATEST version reaches them
// at once. Anything that touches Assessed (a field that carries validations and
// comments), Core or AI input stays as pinned.

const item = (
  fieldKey: string,
  visibility: ConfigItem['visibility'],
  extra: Partial<ConfigItem> = {},
): ConfigItem => ({
  resultTypeKey: 'policy_change',
  fieldKey,
  visibility,
  isCore: false,
  isAiInput: false,
  ...extra,
});

const byKey = (items: readonly ConfigItem[]) =>
  Object.fromEntries(items.map((i) => [i.fieldKey, i]));

describe('withLiveVisibility', () => {
  it('hides a View only field the latest version made Hidden (the F-005 case)', () => {
    const out = byKey(
      withLiveVisibility(
        'policy_change',
        [item('general.reported_year', 'view_only')],
        [item('general.reported_year', 'hidden')],
      ),
    );
    expect(out['general.reported_year']?.visibility).toBe('hidden');
  });

  it('shows as View only a Hidden field the latest version made View only', () => {
    const out = byKey(
      withLiveVisibility(
        'policy_change',
        [item('general.lead_contact', 'hidden')],
        [item('general.lead_contact', 'view_only')],
      ),
    );
    expect(out['general.lead_contact']?.visibility).toBe('view_only');
  });

  it('reads a field with no pinned item as Hidden, so the latest View only shows it', () => {
    const out = byKey(
      withLiveVisibility(
        'policy_change',
        [],
        [item('general.lead_contact', 'view_only')],
      ),
    );
    expect(out['general.lead_contact']).toEqual(
      item('general.lead_contact', 'view_only'),
    );
  });

  it('reads a field with no latest item as Hidden, so a pinned View only goes away', () => {
    const out = byKey(
      withLiveVisibility(
        'policy_change',
        [item('general.notes', 'view_only')],
        [],
      ),
    );
    expect(out['general.notes']?.visibility).toBe('hidden');
  });

  it('keeps an Assessed field as pinned whatever the latest version says', () => {
    const pinned = item('general.title', 'assessed', { isCore: true });
    for (const latest of ['hidden', 'view_only'] as const) {
      const out = byKey(
        withLiveVisibility(
          'policy_change',
          [pinned],
          [item('general.title', latest)],
        ),
      );
      expect(out['general.title']).toEqual(pinned);
    }
  });

  it('never makes a field Assessed in a running timeline', () => {
    for (const pinned of ['hidden', 'view_only'] as const) {
      const out = byKey(
        withLiveVisibility(
          'policy_change',
          [item('general.description', pinned)],
          [item('general.description', 'assessed', { isCore: true })],
        ),
      );
      expect(out['general.description']?.visibility).toBe(pinned);
      expect(out['general.description']?.isCore).toBe(false);
    }
  });

  it('keeps the pinned Core and AI input flags when only the visibility moves', () => {
    const out = byKey(
      withLiveVisibility(
        'policy_change',
        [item('general.tags', 'view_only', { isAiInput: true })],
        [item('general.tags', 'hidden', { isAiInput: false, isCore: true })],
      ),
    );
    expect(out['general.tags']).toEqual(
      item('general.tags', 'hidden', { isAiInput: true }),
    );
  });

  it('returns the pinned items unchanged when the latest version is the same', () => {
    const pinned = [
      item('a', 'assessed', { isCore: true }),
      item('b', 'view_only'),
      item('c', 'hidden'),
    ];
    expect(withLiveVisibility('policy_change', pinned, pinned)).toEqual(pinned);
  });

  it('ignores items of another result type in the latest list', () => {
    const out = withLiveVisibility(
      'policy_change',
      [item('general.reported_year', 'view_only')],
      [
        {
          ...item('general.reported_year', 'hidden'),
          resultTypeKey: 'innovation_use',
        },
      ],
    );
    // policy_change has no latest item for it: it reads Hidden.
    expect(byKey(out)['general.reported_year']?.visibility).toBe('hidden');
    expect(out.every((i) => i.resultTypeKey === 'policy_change')).toBe(true);
  });
});
