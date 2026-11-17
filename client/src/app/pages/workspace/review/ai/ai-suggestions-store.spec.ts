import { TestBed } from '@angular/core/testing';
import { Observable, Subject, of, throwError } from 'rxjs';
import { AiSuggestionsApi } from '../../../../core/api/ai-suggestions-api';
import { AiSuggestionEvent, AiSuggestionView } from '../../../../core/api/ai-suggestions.models';
import { AI_NOT_AVAILABLE } from './ai-chip.vm';
import { AiSuggestionsStore } from './ai-suggestions-store';

const views: AiSuggestionView[] = [
  {
    status: 'available',
    fieldKey: 'general.gender_tag',
    suggestionId: 's-g',
    signal: 'amber',
    suggestedValue: 1,
    explanation: 'Only one activity mentions women.',
    evidenceQuote: '',
    quoteVerified: false,
    evidenceSource: null,
    promptVersion: 'v2-1.0.0',
    modelId: 'm',
  },
  {
    status: 'available',
    fieldKey: 'innovation_dev.readiness_level',
    suggestionId: 's-irl',
    signal: 'red',
    suggestedValue: 3,
    explanation: 'Piloted in one site.',
    evidenceQuote: 'piloted in one site',
    quoteVerified: true,
    evidenceSource: null,
    promptVersion: 'v2-1.0.0',
    modelId: 'm',
  },
  { status: 'unavailable', fieldKey: 'general.climate_tag', unavailableReason: 'private_link' },
];

class FakeApi {
  list$: Observable<readonly AiSuggestionView[]> = of(views);
  events: Array<{ id: string; event: AiSuggestionEvent }> = [];
  failEvents = false;
  list(): Observable<readonly AiSuggestionView[]> {
    return this.list$;
  }
  sendEvent(_t: number, _r: number, id: string, event: AiSuggestionEvent): Observable<void> {
    this.events.push({ id, event });
    return this.failEvents ? throwError(() => new Error('down')) : of(undefined);
  }
}

describe('AiSuggestionsStore', () => {
  let api: FakeApi;
  let store: AiSuggestionsStore;

  beforeEach(() => {
    api = new FakeApi();
    TestBed.configureTestingModule({
      providers: [AiSuggestionsStore, { provide: AiSuggestionsApi, useValue: api }],
    });
    store = TestBed.inject(AiSuggestionsStore);
  });

  it('maps every view to a chip by field', async () => {
    await store.load(3, 5001);
    expect(store.state()).toBe('ready');
    expect(store.byField().get('general.gender_tag')).toMatchObject({
      kind: 'available',
      label: 'Check',
    });
    expect(store.byField().get('general.climate_tag')).toMatchObject({ kind: 'unavailable' });
    expect(store.chipFor('general.title')).toBeNull();
  });

  it('degrades to "Suggestion not available" when the read fails, never throws', async () => {
    api.list$ = throwError(() => new Error('503'));
    await store.load(3, 5001);
    expect(store.failed()).toBe(true);
    expect(store.chipFor('general.gender_tag', true)).toMatchObject({
      kind: 'unavailable',
      label: AI_NOT_AVAILABLE,
    });
    expect(store.chipFor('general.title')).toBeNull();
  });

  it('ignores the answer of an older load', async () => {
    const slow = new Subject<readonly AiSuggestionView[]>();
    api.list$ = slow;
    const first = store.load(3, 5001);
    api.list$ = of([]);
    await store.load(3, 5002);
    slow.next(views);
    slow.complete();
    await first;
    expect(store.byField().size).toBe(0);
  });

  it('reports shown once per suggestion, only for available ones', async () => {
    await store.load(3, 5001);
    store.markShown('general.gender_tag');
    store.markShown('general.gender_tag');
    store.markShown('general.climate_tag');
    expect(api.events).toEqual([{ id: 's-g', event: { action: 'shown' } }]);
  });

  it('copy returns the explanation and posts copied once; comment_saved only after a copy', async () => {
    await store.load(3, 5001);
    store.commentSaved('general.gender_tag', 10);
    expect(store.copied('general.gender_tag')).toBe('Only one activity mentions women.');
    store.copied('general.gender_tag');
    store.commentSaved('general.gender_tag', 11);
    expect(api.events).toEqual([
      { id: 's-g', event: { action: 'copied' } },
      { id: 's-g', event: { action: 'comment_saved', commentId: '11' } },
    ]);
    expect(store.copied('general.climate_tag')).toBeNull();
  });

  it('a failing event never throws', async () => {
    await store.load(3, 5001);
    api.failEvents = true;
    expect(() => store.markShown('general.gender_tag')).not.toThrow();
    await expect(
      store.validatedAbove('innovation_dev.readiness_level', 6, 'Field visit'),
    ).resolves.toBeUndefined();
  });

  it('posts validated_above_ai with the stored AI level', async () => {
    await store.load(3, 5001);
    await store.validatedAbove(
      'innovation_dev.readiness_level',
      6,
      'Second pilot reported in the annex',
    );
    expect(api.events).toEqual([
      {
        id: 's-irl',
        event: {
          action: 'validated_above_ai',
          aiLevel: 3,
          validatedLevel: 6,
          reason: 'Second pilot reported in the annex',
        },
      },
    ]);
  });
});
