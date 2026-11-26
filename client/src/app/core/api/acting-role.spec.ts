import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { ACTING_ROLE_HEADER, ACTING_ROLE_LABELS, ActingRoleState, actingRoleFor, actingRoleInterceptor, reviewerLabel } from './acting-role';
import { AssessmentApi } from './assessment-api';

const API = 'https://api.test/api/v1';
const ok = (data: unknown) => ({ success: true, data, meta: { requestId: 'r', timestamp: 't' } });

describe('actingRoleFor', () => {
  const pick = { timelineId: 3, resultCode: 9890, role: 'ASSESSOR' as const };

  it('sends nothing without a pick', () => {
    expect(actingRoleFor(`${API}/timelines/3/results/9890/assessment`, null)).toBeNull();
  });

  it('covers every route of the picked result and only that result', () => {
    for (const path of ['assessment', 'assessment/validations', 'assessment/comments', 'assessment/finish', 'assessment/decisions/7']) {
      expect(actingRoleFor(`${API}/timelines/3/results/9890/${path}`, pick)).toBe('ASSESSOR');
    }
    expect(actingRoleFor(`${API}/timelines/3/results/9891/assessment`, pick)).toBeNull();
    expect(actingRoleFor(`${API}/timelines/4/results/9890/assessment`, pick)).toBeNull();
  });

  it('TPB and PPU are roles the Admin can act as, with their names (P2-3916, P2-3917)', () => {
    expect(ACTING_ROLE_LABELS).toEqual({ ASSESSOR: 'Assessor', LEAD_ASSESSOR: 'Lead Assessor', TPB: 'TPB', PPU: 'PPU' });
    expect(actingRoleFor(`${API}/timelines/3/results/9890/assessment/decisions/7`, { ...pick, role: 'TPB' })).toBe('TPB');
    expect(actingRoleFor(`${API}/timelines/3/results/9890/assessment`, { ...pick, role: 'PPU' })).toBe('PPU');
  });

  it('covers withdraw, delete and quick comments', () => {
    expect(actingRoleFor(`${API}/assessment-comments/12/withdraw`, pick)).toBe('ASSESSOR');
    expect(actingRoleFor(`${API}/assessment-comments/12/delete`, pick)).toBe('ASSESSOR');
    expect(actingRoleFor(`${API}/quick-comments`, pick)).toBe('ASSESSOR');
    expect(actingRoleFor(`${API}/quick-comments?role=ASSESSOR`, pick)).toBe('ASSESSOR');
  });

  it('never touches the program responses, the clarification answer or the worklist', () => {
    expect(actingRoleFor(`${API}/timelines/3/results/9890/sp-responses`, pick)).toBeNull();
    expect(actingRoleFor(`${API}/assessment-comments/12/clarification-answer`, pick)).toBeNull();
    expect(actingRoleFor(`${API}/timelines/3/worklist`, pick)).toBeNull();
    expect(actingRoleFor(`${API}/worklist/timelines`, pick)).toBeNull();
  });
});

describe('ActingRoleState', () => {
  it('drops a pick made on another result, keeps the one of this result', () => {
    const state = new ActingRoleState();
    state.set(3, 9890, 'LEAD_ASSESSOR');
    state.keepOnly(3, 9890);
    expect(state.pick()).toEqual({ timelineId: 3, resultCode: 9890, role: 'LEAD_ASSESSOR' });
    state.keepOnly(3, 9891);
    expect(state.pick()).toBeNull();
  });

  it('a null role is reading only', () => {
    const state = new ActingRoleState();
    state.set(3, 9890, 'ASSESSOR');
    state.set(3, 9890, null);
    expect(state.pick()).toBeNull();
  });
});

describe('actingRoleInterceptor', () => {
  let http: HttpTestingController;
  let api: AssessmentApi;
  let state: ActingRoleState;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([actingRoleInterceptor])),
        provideHttpClientTesting(),
        { provide: APP_CONFIG, useValue: { name: 'test', apiBaseUrl: API, ssoCallbackPath: '/auth/callback' } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    api = TestBed.inject(AssessmentApi);
    state = TestBed.inject(ActingRoleState);
  });
  afterEach(() => http.verify());

  it('sends no header without a pick (the Admin reads only)', async () => {
    const read = firstValueFrom(api.view(3, 9890));
    const req = http.expectOne(`${API}/timelines/3/results/9890/assessment`);
    expect(req.request.headers.has(ACTING_ROLE_HEADER)).toBe(false);
    req.flush(ok({}));
    await read;
  });

  it('sends the picked role on the read and the writes of that result', async () => {
    state.set(3, 9890, 'ASSESSOR');
    const read = firstValueFrom(api.view(3, 9890));
    const view = http.expectOne(`${API}/timelines/3/results/9890/assessment`);
    expect(view.request.headers.get(ACTING_ROLE_HEADER)).toBe('ASSESSOR');
    view.flush(ok({}));
    await read;

    const done = firstValueFrom(api.finish(3, 9890));
    const finish = http.expectOne(`${API}/timelines/3/results/9890/assessment/finish`);
    expect(finish.request.headers.get(ACTING_ROLE_HEADER)).toBe('ASSESSOR');
    finish.flush(ok({ status: 'quality_assessed', assessedBy: null, finishedAt: null, validations: [] }));
    await done;
  });

  it('leaves the program responses of the same result alone', async () => {
    state.set(3, 9890, 'ASSESSOR');
    const read = firstValueFrom(api.programResponses(3, 9890));
    const req = http.expectOne(`${API}/timelines/3/results/9890/sp-responses`);
    expect(req.request.headers.has(ACTING_ROLE_HEADER)).toBe(false);
    req.flush(ok({ comments: [] }));
    await read;
  });
});

describe('reviewerLabel', () => {
  it('names the Admin when an Admin wrote it', () => {
    expect(reviewerLabel({ id: 1, nickname: 'jd', admin: true })).toBe('Admin · jd');
    expect(reviewerLabel({ id: 1, nickname: null, admin: true })).toBe('Admin');
  });

  it('keeps the nickname, or the fallback, for anyone else', () => {
    expect(reviewerLabel({ id: 2, nickname: 'mchen' })).toBe('mchen');
    expect(reviewerLabel({ id: 2, nickname: null })).toBe('—');
    expect(reviewerLabel(null, 'n/a')).toBe('n/a');
  });
});
