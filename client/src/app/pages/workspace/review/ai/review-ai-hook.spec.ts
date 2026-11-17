import { Injectable, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AiSuggestionsApi } from '../../../../core/api/ai-suggestions-api';
import type {
  AiSuggestionEvent,
  AiSuggestionView,
} from '../../../../core/api/ai-suggestions.models';
import type { AssessmentView } from '../../../../core/api/assessment.models';
import { field, viewFixture } from '../review.api-fixture';
import { ReviewStore } from '../review-store';
import { ReviewFieldCard } from '../review-field-card';
import { toFieldVm } from '../review.mapper';
import { RESULT_CATEGORY_VIEW, USE_NUMBERS_VIEW } from './ai-chip.indicative.fixtures';
import { REVIEW_AI_PROVIDERS, ReviewAiHook, reportedCategory } from './review-ai-hook';

const GENDER: AiSuggestionView = {
  status: 'available',
  fieldKey: 'general.gender_tag',
  suggestionId: 'g1',
  signal: 'red',
  valueKind: 'level',
  suggestedValue: 0,
  explanation: 'The evidence does not mention gender.',
  evidenceQuote: 'trained farmers',
  quoteVerified: true,
  evidenceSource: null,
  promptVersion: 'v2-1.0.0',
  modelId: 'anthropic.claude-haiku-5-5',
};

/** The Review store as the hook reads it: the loaded view and its timeline. */
@Injectable()
class FakeReviewStore {
  readonly view = signal<AssessmentView | null>(null);
  readonly timelineId = signal<number | null>(null);
}

function setup(views: AiSuggestionView[] = [GENDER, RESULT_CATEGORY_VIEW, USE_NUMBERS_VIEW]) {
  const lists: [number, number][] = [];
  const events: AiSuggestionEvent[] = [];
  TestBed.configureTestingModule({
    providers: [
      ...REVIEW_AI_PROVIDERS,
      { provide: ReviewStore, useClass: FakeReviewStore },
      {
        provide: AiSuggestionsApi,
        useValue: {
          list: (t: number, r: number) => {
            lists.push([t, r]);
            return of(views);
          },
          sendEvent: (_t: number, _r: number, _id: string, e: AiSuggestionEvent) => {
            events.push(e);
            return of(undefined);
          },
        },
      },
    ],
  });
  const review = TestBed.inject(ReviewStore) as unknown as FakeReviewStore;
  const hook = TestBed.inject(ReviewAiHook);
  return { review, hook, lists, events };
}

const aiView = (writable = true): AssessmentView =>
  viewFixture({
    writable,
    sections: [
      {
        key: 'general_information',
        label: 'General information',
        fields: [
          field({ key: 'general.gender_tag', label: 'Gender tag', value: 1 }),
          field({
            key: 'general.result_type',
            label: 'Result type',
            value: 5,
            labels: { result_types: { '5': 'Policy change' } },
          }),
        ],
      },
      {
        key: 'innovation_use',
        label: 'Innovation use',
        fields: [
          field({
            key: 'innovation_use.current_use.actors',
            label: 'Actors',
            type: 'list',
            value: [{ actor_type: 1, how_many: 1000 }],
            labels: { actor_types: { '1': 'Farmers' } },
          }),
          field({
            key: 'innovation_use.current_use.organizations',
            label: 'Organizations',
            type: 'list',
            value: [],
          }),
          field({
            key: 'innovation_use.current_use.measures',
            label: 'Measures',
            type: 'list',
            value: [{ quantity: 40, unit_of_measure: 'hectares' }],
          }),
        ],
      },
    ],
  });

async function loaded(writable = true, views?: AiSuggestionView[]) {
  const s = setup(views);
  s.review.timelineId.set(27);
  s.review.view.set(aiView(writable));
  TestBed.tick();
  await Promise.resolve();
  await Promise.resolve();
  return s;
}

describe('ReviewAiHook (P2-3918 plan A)', () => {
  it('loads the suggestions of the result the Review page loaded, once per result', async () => {
    const { lists } = await loaded();
    expect(lists).toEqual([[27, 9890]]);
  });

  it('gives each covered field its chip, and none to a field the AI does not cover', async () => {
    const { hook } = await loaded();
    expect(hook.chip('general.gender_tag')).toMatchObject({ kind: 'available', signal: 'red' });
    expect(hook.chip('general.title')).toBeNull();
  });

  it('passes the reported category label to the result-type chip', async () => {
    const { hook } = await loaded();
    expect(hook.chip('general.result_type')).toMatchObject({
      kind: 'available',
      indicative: { kind: 'category', suggested: 'Innovation', reported: 'Policy change' },
    });
  });

  it('passes the reported use numbers (actors, organizations, measures) to the use-numbers chip', async () => {
    const { hook } = await loaded();
    const chip = hook.chip('innovation_use.current_use.actors');
    expect(chip).toMatchObject({ kind: 'available', indicative: { kind: 'use_numbers' } });
    const reported =
      chip?.kind === 'available' && chip.indicative?.kind === 'use_numbers'
        ? chip.indicative.reported
        : [];
    expect(reported.length).toBeGreaterThan(0);
  });

  it('is read only where the page is not writable (TPB, ADMIN)', async () => {
    expect((await loaded(false)).hook.readOnly()).toBe(true);
    TestBed.resetTestingModule();
    expect((await loaded(true)).hook.readOnly()).toBe(false);
  });

  it('"Copy to comment" posts copied once and returns the text; it never comments or validates (AC6)', async () => {
    const { hook, events } = await loaded();
    expect(hook.copy('general.gender_tag')).toContain('The evidence does not mention gender.');
    hook.copy('general.gender_tag');
    expect(events).toEqual([{ action: 'copied' }]);
  });

  it('shown is posted once per suggestion', async () => {
    const { hook, events } = await loaded();
    hook.shown('general.gender_tag');
    hook.shown('general.gender_tag');
    expect(events).toEqual([{ action: 'shown' }]);
  });
});

describe('reportedCategory', () => {
  it("prefers Reporting's label, then the header type, then the raw value", () => {
    const view = viewFixture();
    expect(
      reportedCategory(
        field({
          key: 'general.result_type',
          label: 'R',
          value: 5,
          labels: { t: { '5': 'Innovation development' } },
        }),
        view,
      ),
    ).toBe('Innovation development');
    expect(
      reportedCategory(
        field({ key: 'general.result_type', label: 'R', value: 'policy_change' }),
        view,
      ),
    ).toBe('Policy change');
    expect(
      reportedCategory(field({ key: 'general.result_type', label: 'R', value: 7 }), view),
    ).toBe('7');
    expect(
      reportedCategory(field({ key: 'general.result_type', label: 'R', value: null }), view),
    ).toBeNull();
  });
});

describe('Review field card AI slot', () => {
  it('renders the chip when the page gives one, and nothing otherwise', async () => {
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(ReviewFieldCard);
    fixture.componentRef.setInput(
      'field',
      toFieldVm(field({ key: 'general.gender_tag', label: 'Gender tag', value: 1 }), true),
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('qa-ai-chip')).toBeNull();

    fixture.componentRef.setInput('aiChip', {
      kind: 'pending',
      fieldKey: 'general.gender_tag',
      label: 'Suggestion in progress',
    });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('qa-ai-chip')?.textContent).toContain(
      'Suggestion in progress',
    );
  });
});
