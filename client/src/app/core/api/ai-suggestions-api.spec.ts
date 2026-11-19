import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { ApiError } from '../http/api-envelope';
import { NO_QUEUE, SILENT_ERRORS } from '../http/request-context';
import { AiSuggestionsApi } from './ai-suggestions-api';
import { AiSuggestionView } from './ai-suggestions.models';

const API = 'https://api.test/api/v1';
const meta = { requestId: 'r', timestamp: 't' };

describe('AiSuggestionsApi', () => {
  let http: HttpTestingController;
  let api: AiSuggestionsApi;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: APP_CONFIG,
          useValue: { name: 'test', apiBaseUrl: API, ssoCallbackPath: '/auth/callback' },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    api = TestBed.inject(AiSuggestionsApi);
  });
  afterEach(() => http.verify());

  it('reads the suggestions of a result, silently', async () => {
    const answer = firstValueFrom(api.list(3, 5001));
    const req = http.expectOne(`${API}/timelines/3/results/5001/ai-suggestions`);
    expect(req.request.method).toBe('GET');
    expect(req.request.context.get(SILENT_ERRORS)).toBe(true);
    const views: AiSuggestionView[] = [
      { status: 'pending', fieldKey: 'general.gender_tag' },
      { status: 'unavailable', fieldKey: 'general.climate_tag', unavailableReason: 'private_link' },
    ];
    req.flush({ success: true, data: views, meta });
    expect(await answer).toEqual(views);
  });

  it('posts an event outside the Unsent list', async () => {
    const answer = firstValueFrom(api.sendEvent(3, 5001, 'abc', { action: 'copied' }));
    const req = http.expectOne(`${API}/timelines/3/results/5001/ai-suggestions/abc/events`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ action: 'copied' });
    expect(req.request.context.get(NO_QUEUE)).toBe(true);
    expect(req.request.context.get(SILENT_ERRORS)).toBe(true);
    req.flush(null, { status: 204, statusText: 'No Content' });
    await expect(answer).resolves.toBeUndefined();
  });

  it('turns a 403 into the catalog error', async () => {
    const answer = firstValueFrom(api.list(3, 5001));
    http
      .expectOne(`${API}/timelines/3/results/5001/ai-suggestions`)
      .flush(
        {
          success: false,
          error: { status: 403, code: 'AI_SUGGESTIONS_FORBIDDEN', message: 'No.' },
          meta,
        },
        { status: 403, statusText: 'Forbidden' },
      );
    await expect(answer).rejects.toBeInstanceOf(ApiError);
  });
});
