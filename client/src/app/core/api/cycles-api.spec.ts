import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { NO_QUEUE, SILENT_ERRORS, UNSENT_LABEL } from '../http/request-context';
import { CyclesApi } from './cycles-api';

const API = 'https://api.test/api/v1';
const meta = { requestId: 'r', timestamp: 't' };

describe('CyclesApi', () => {
  let http: HttpTestingController;
  let api: CyclesApi;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: APP_CONFIG, useValue: { name: 'test', apiBaseUrl: API, ssoCallbackPath: '/auth/callback' } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    api = TestBed.inject(CyclesApi);
  });
  afterEach(() => http.verify());

  it('reads cycles, defaults, timelines and one timeline from the contract routes', async () => {
    const cycles = firstValueFrom(api.list());
    http.expectOne(`${API}/cycles`).flush({ success: true, data: [{ id: 3 }], meta });
    expect((await cycles).map((c) => c.id)).toEqual([3]);
    void firstValueFrom(api.defaults());
    void firstValueFrom(api.timelines(3));
    void firstValueFrom(api.timeline(9));
    for (const url of ['timeline-defaults', 'cycles/3/timelines', 'timelines/9']) {
      http.expectOne(`${API}/${url}`).flush({ success: true, data: [], meta });
    }
  });

  it('creates are silent, labelled and replayable (the server honors Idempotency-Key)', () => {
    void firstValueFrom(api.create(2027));
    void firstValueFrom(api.createTimeline(3, { name: 'July', allPrograms: true, allResultTypes: true, steps: [] }));
    const [cycle, timeline] = [http.expectOne(`${API}/cycles`), http.expectOne(`${API}/cycles/3/timelines`)];
    expect(cycle.request.body).toEqual({ year: 2027 });
    expect(cycle.request.context.get(UNSENT_LABEL)).toBe('Create the 2027 cycle');
    for (const req of [cycle, timeline]) {
      expect(req.request.context.get(SILENT_ERRORS)).toBe(true);
      expect(req.request.context.get(NO_QUEUE)).toBe(false);
      req.flush({ success: true, data: { id: 1 }, meta });
    }
  });

  it('activate is never queued: it closes the active cycle', () => {
    void firstValueFrom(api.activate({ id: 3, name: '2027 cycle' }));
    const req = http.expectOne(`${API}/cycles/3/activate`);
    expect(req.request.method).toBe('POST');
    expect(req.request.context.get(NO_QUEUE)).toBe(true);
    req.flush({ success: true, data: { id: 3, status: 'active' }, meta });
  });

  it('assigns with userId + role and removes with a 204', async () => {
    void firstValueFrom(api.assign(9, 7, 'ASSESSOR', 'Ada'));
    const assign = http.expectOne(`${API}/timelines/9/users`);
    expect(assign.request.body).toEqual({ userId: 7, role: 'ASSESSOR' });
    assign.flush({ success: true, data: { assignmentId: 1 }, meta }, { status: 200, statusText: 'OK' });
    const removed = firstValueFrom(api.unassign(9, 1, 'Ada'));
    const del = http.expectOne(`${API}/timelines/9/users/1`);
    expect(del.request.method).toBe('DELETE');
    del.flush(null, { status: 204, statusText: 'No Content' });
    expect(await removed).toBeUndefined();
  });
});
