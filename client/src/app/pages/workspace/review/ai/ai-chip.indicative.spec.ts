import { TestBed } from '@angular/core/testing';
import {
  AI_INDICATIVE_META,
  AI_NO_USE_NUMBERS,
  AI_USE_NUMBERS_COVERS,
  copyTextOf,
  reportedUseRows,
  toAiChipVm,
} from './ai-chip.vm';
import { AiChip } from './ai-chip';
import { needsReason } from './ai-reason';
import {
  EMPTY_USE_NUMBERS_VIEW,
  RESULT_CATEGORY_VIEW,
  USE_NUMBERS_VIEW,
} from './ai-chip.indicative.fixtures';

function render(vm: ReturnType<typeof toAiChipVm>, readOnly = false): HTMLElement {
  const fixture = TestBed.createComponent(AiChip);
  fixture.componentRef.setInput('vm', vm);
  fixture.componentRef.setInput('readOnly', readOnly);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const STATUS_BADGES = /qa-badge--(approved|editing|rejected)|bg-\(--st-(approved|editing|rejected)/;

describe('indicative AI chip (contract 2.0.0)', () => {
  describe('result category (general.result_type)', () => {
    it('is neutral: label, meta line, suggested category, no quote', () => {
      const vm = toAiChipVm(RESULT_CATEGORY_VIEW);
      expect(vm.kind).toBe('available');
      if (vm.kind !== 'available') return;
      expect(vm.signal).toBe('indicative');
      expect(vm.label).toBe('Indicative');
      expect(vm.meta).toBe('Only a suggestion');
      expect(vm.quote).toBeNull();
      expect(vm.headline).toBeNull();
      expect(vm.indicative).toEqual({ kind: 'category', suggested: 'Innovation', reported: null });
    });

    it('shows the reported category beside the suggestion when the page passes it', () => {
      const vm = toAiChipVm(RESULT_CATEGORY_VIEW, 'Innovation development');
      expect(vm.kind === 'available' && vm.indicative).toEqual({
        kind: 'category',
        suggested: 'Innovation',
        reported: 'Innovation development',
      });
      const el = render(vm);
      const dl = el.querySelector('[data-testid="ai-category"]')!.textContent!;
      expect(dl).toContain('Suggested category');
      expect(dl).toContain('Innovation');
      expect(dl).toContain('Reported');
      expect(dl).toContain('Innovation development');
    });

    it('renders without colour, verdict or quote, and keeps Use as comment', () => {
      const el = render(toAiChipVm(RESULT_CATEGORY_VIEW));
      const text = el.textContent!;
      expect(text).toContain('Only a suggestion');
      expect(text).toContain(AI_INDICATIVE_META);
      expect(text).not.toMatch(/Review|Incorrect|Looks consistent|Check/);
      expect(el.innerHTML).not.toMatch(STATUS_BADGES);
      expect(el.querySelector('[data-testid="ai-signal"] .rounded-full')).toBeNull();
      expect(el.querySelector('blockquote')).toBeNull();
      expect(el.querySelector('[data-testid="ai-explanation"]')!.textContent).toContain('Novelty');
      expect(
        [...el.querySelectorAll('button')].some((b) => b.textContent!.includes('Use as comment')),
      ).toBe(true);
    });
  });

  describe('innovation use numbers (innovation_use.current_use.actors)', () => {
    it('lists the suggested rows and says it covers actors, organizations and measures', () => {
      const vm = toAiChipVm(USE_NUMBERS_VIEW);
      if (vm.kind !== 'available' || vm.indicative?.kind !== 'use_numbers') throw new Error('vm');
      expect(vm.indicative.covers).toBe(
        'This suggestion covers actors, organizations and measures.',
      );
      expect(vm.indicative.suggested).toEqual([
        {
          group: 'Actors',
          type: 'Farmers/ (agro)pastoralist/ herders/ fishers',
          quantity: 1200,
          detail: 'women 700 · men 500 · Kenya',
        },
        { group: 'Measures', type: 'hectares', quantity: 50.5, detail: '' },
      ]);
      const el = render(vm);
      expect(el.querySelector('[data-testid="ai-covers"]')!.textContent).toContain(
        'covers actors, organizations and measures',
      );
      expect(el.textContent).toContain('Only a suggestion');
      expect(el.querySelectorAll('[data-testid="ai-suggested-row"]').length).toBe(2);
      expect(el.textContent).toContain('1,200');
      expect(el.textContent).toContain('Nothing reported.');
      expect(el.innerHTML).not.toMatch(STATUS_BADGES);
      expect(el.textContent).not.toMatch(/Review|Incorrect/);
    });

    it('an empty list means the evidence reports no use numbers', () => {
      const vm = toAiChipVm(EMPTY_USE_NUMBERS_VIEW);
      const el = render(vm);
      expect(el.querySelector('[data-testid="ai-no-numbers"]')!.textContent).toContain(
        'The evidence reports no use numbers.',
      );
      expect(AI_NO_USE_NUMBERS).toBe('The evidence reports no use numbers.');
      expect(AI_USE_NUMBERS_COVERS).toContain('covers actors, organizations and measures');
    });

    it('shows the reported rows next to the suggested ones', () => {
      const reported = reportedUseRows(
        {
          actors: [{ actor_type: 1, how_many: 1000, men: 400, women: 600 }],
          organizations: [],
          measures: [{ quantity: 40, unit_of_measure: 'hectares' }],
        },
        { '1': 'Farmers' },
      );
      expect(reported).toEqual([
        { group: 'actors', type: 'Farmers', quantity: 1000 },
        { group: 'measures', type: 'hectares', quantity: 40 },
      ]);
      const el = render(toAiChipVm(USE_NUMBERS_VIEW, reported));
      const rows = [...el.querySelectorAll('[data-testid="ai-reported-row"]')].map((r) =>
        r.textContent!.trim(),
      );
      expect(rows.length).toBe(2);
      expect(rows[0]).toContain('1,000');
      expect(rows[0]).toContain('Farmers');
    });

    it('copies the explanation plus one line with the suggested numbers', () => {
      expect(copyTextOf(USE_NUMBERS_VIEW)).toBe(
        'Total 1,250: 1,200 farmers and 50 hectares reported in the 2025 project report.\n' +
          'AI-suggested use numbers: 1,200 Farmers/ (agro)pastoralist/ herders/ fishers; 50.5 hectares.',
      );
      expect(copyTextOf(EMPTY_USE_NUMBERS_VIEW)).toContain(AI_NO_USE_NUMBERS);
      expect(copyTextOf(RESULT_CATEGORY_VIEW)).toBe(RESULT_CATEGORY_VIEW.explanation);
    });
  });

  describe('reportedUseRows (best effort, never throws)', () => {
    it.each([
      [null],
      [undefined],
      [{}],
      [{ actors: 'x', organizations: 3, measures: { a: 1 } }],
      [{ actors: [null, 1, 'x'] }],
    ])('gives no row for an unknown shape: %j', (values) => {
      expect(reportedUseRows(values as never)).toEqual([]);
    });

    it('falls back to the other type, then to "Type <id>", and keeps a missing quantity as null', () => {
      expect(
        reportedUseRows({
          actors: [{ actor_type: 9, other_actor_type: 'Traders' }, { actor_type: 4 }],
          organizations: [{ institution_type: 2, how_many: '3' }],
        }),
      ).toEqual([
        { group: 'actors', type: 'Traders', quantity: null },
        { group: 'actors', type: 'Type 4', quantity: null },
        { group: 'organizations', type: 'Type 2', quantity: 3 },
      ]);
    });
  });

  it('never asks for a reason on an indicative field', () => {
    expect(needsReason('general.result_type', 9, RESULT_CATEGORY_VIEW)).toBe(false);
    expect(needsReason('innovation_use.current_use.actors', 9, USE_NUMBERS_VIEW)).toBe(false);
    // A level field paired with an indicative view (never sent by the server) still never asks.
    expect(
      needsReason('innovation_dev.readiness_level', 9, {
        ...USE_NUMBERS_VIEW,
        fieldKey: 'innovation_dev.readiness_level',
      }),
    ).toBe(false);
  });
});
