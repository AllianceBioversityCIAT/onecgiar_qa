import { HttpContext, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { NO_QUEUE, SILENT_ERRORS, UNSENT_LABEL } from '../http/request-context';
import { UsersApi } from './users-api';

const API = 'https://api.test/api/v1';
const meta = (nextCursor: string | null = null) => ({ requestId: 'r', timestamp: 't', page: { nextCursor } });

describe('UsersApi', () => {
  let http: HttpTestingController;
  let api: UsersApi;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: APP_CONFIG, useValue: { name: 'test', apiBaseUrl: API, ssoCallbackPath: '/auth/callback' } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    api = TestBed.inject(UsersApi);
  });
  afterEach(() => http.verify());

  it('listAll follows nextCursor page by page with the largest page size', async () => {
    const all = firstValueFrom(api.listAll({ status: 'inactive' }));
    const first = http.expectOne((r) => r.url === `${API}/users` && !r.params.has('cursor'));
    expect(first.request.params.get('limit')).toBe('200');
    expect(first.request.params.get('status')).toBe('inactive');
    first.flush({ success: true, data: [{ id: 1 }], meta: meta('c2') });
    const second = http.expectOne((r) => r.params.get('cursor') === 'c2');
    second.flush({ success: true, data: [{ id: 2 }], meta: meta(null) });
    expect((await all).map((u) => u.id)).toEqual([1, 2]);
  });

  it('create is silent, labelled and never queued for replay', () => {
    void firstValueFrom(
      api.create({ email: 'a@x.org', firstName: 'A', lastName: 'B', nickname: 'AB', accountType: 'custom' }),
    );
    const req = http.expectOne(`${API}/users`);
    const ctx: HttpContext = req.request.context;
    expect(ctx.get(NO_QUEUE)).toBe(true);
    expect(ctx.get(SILENT_ERRORS)).toBe(true);
    expect(ctx.get(UNSENT_LABEL)).toBe('Invite a@x.org');
    req.flush({ success: true, data: { id: 1 }, meta: meta() });
  });

  it('invitation and exclusions are never queued (a repeat sends another email / answers 409)', () => {
    void firstValueFrom(api.resendInvitation(3, 'Ada'));
    void firstValueFrom(api.addExclusion(3, 441, 'Co-author', 'Ada'));
    for (const req of http.match(() => true)) {
      expect(req.request.context.get(NO_QUEUE)).toBe(true);
      req.flush({ success: true, data: { id: 3 }, meta: meta() });
    }
  });

  it('other writes are silent and can be queued', () => {
    void firstValueFrom(api.setPrograms(3, 'all', 'Ada'));
    const req = http.expectOne(`${API}/users/3/programs`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ programs: 'all' });
    expect(req.request.context.get(NO_QUEUE)).toBe(false);
    expect(req.request.context.get(SILENT_ERRORS)).toBe(true);
    req.flush({ success: true, data: { id: 3 }, meta: meta() });
  });
});
