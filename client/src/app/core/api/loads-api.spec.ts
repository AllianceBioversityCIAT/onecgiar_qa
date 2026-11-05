import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { ApiError } from '../http/api-envelope';
import { NO_QUEUE } from '../http/request-context';
import { LoadsApi } from './loads-api';

const API = 'https://api.test/api/v1';
const meta = { requestId: 'r', timestamp: 't' };

describe('LoadsApi', () => {
  let http: HttpTestingController;
  let api: LoadsApi;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: APP_CONFIG, useValue: { name: 'test', apiBaseUrl: API, ssoCallbackPath: '/auth/callback' } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    api = TestBed.inject(LoadsApi);
  });
  afterEach(() => http.verify());

  it('reads the preview of a timeline', async () => {
    const answer = firstValueFrom(api.preview(27));
    const req = http.expectOne(`${API}/timelines/27/loads/preview`);
    expect(req.request.method).toBe('GET');
    const preview = { phaseYear: 2026, window: 'open', toLoad: { total: 33, byProgram: [], byResultType: [] }, kpGroups: { notInQa: 0, autoChecked: 1, review: 2 }, skipped: [] };
    req.flush({ success: true, data: preview, meta });
    expect((await answer).toLoad.total).toBe(33);
  });

  it('starts a load with an empty body, outside the Unsent list', async () => {
    const answer = firstValueFrom(api.start(27, 'July'));
    const req = http.expectOne(`${API}/timelines/27/loads`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    expect(req.request.context.get(NO_QUEUE)).toBe(true);
    req.flush({ success: true, data: { id: 9, status: 'running' }, meta }, { status: 202, statusText: 'Accepted' });
    expect(await answer).toEqual({ id: 9, status: 'running' });
  });

  it('lists the loads and reads one with its summary', async () => {
    const list = firstValueFrom(api.list(27));
    http.expectOne(`${API}/timelines/27/loads`).flush({ success: true, data: [{ id: 9, status: 'running', total: null, processed: 0 }], meta });
    expect((await list)[0].total).toBeNull();
    const one = firstValueFrom(api.get(27, 9));
    http.expectOne(`${API}/timelines/27/loads/9`).flush({ success: true, data: { id: 9, status: 'completed', summary: { loaded: 33 } }, meta });
    expect((await one).summary.loaded).toBe(33);
  });

  it.each([
    [409, 'LOADS_ALREADY_RUNNING'],
    [409, 'LOADS_WINDOW_CLOSED'],
    [409, 'CYCLES_CLOSED'],
    [503, 'SERVICE_UNAVAILABLE'],
  ])('surfaces %i %s as an ApiError with its code', async (status, code) => {
    const answer = firstValueFrom(api.start(27, 'July'));
    http
      .expectOne(`${API}/timelines/27/loads`)
      .flush({ success: false, error: { status, code, message: 'server text' }, meta }, { status, statusText: 'x' });
    const error = await answer.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe(code);
  });
});
