import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { APP_CONFIG } from '../../../core/config/app-config';
import { WriteEvents } from '../../../core/http/write-events';
import { TimelinePeople } from './timeline-people';

const API = 'https://api.test/api/v1';
const meta = { requestId: 'r', timestamp: 't' };
const ok = (data: unknown) => ({ success: true, data, meta });
const fail = (status: number, code: string) => ({ success: false, error: { status, code, message: `server says ${code}`, fields: [] }, meta });

const member = (id: number, first: string, roles: unknown[]) => ({
  id,
  email: `u${id}@cgiar.org`,
  firstName: first,
  lastName: 'Doe',
  nickname: null,
  accountType: 'sso',
  status: 'active',
  lastSignInAt: null,
  invitation: 'none',
  roles,
  programs: 'all',
  exclusions: [],
});
const assignment = (assignmentId: number, userId: number, role: string, first = 'Ana') => ({
  assignmentId,
  userId,
  firstName: first,
  lastName: 'Doe',
  email: `u${userId}@cgiar.org`,
  role,
  assignedAt: '2026-11-10T15:00:00Z',
});
const detail = (users: unknown[]) => ({
  id: 7,
  cycleId: 2,
  name: 'July',
  kind: 'additional',
  allPrograms: true,
  programIds: [],
  allResultTypes: true,
  resultTypeKeys: [],
  steps: [],
  status: 'live',
  currentStep: 1,
  nextStep: null,
  readiness: [],
  assignedCount: { ASSESSOR: 0, LEAD_ASSESSOR: 0, TPB: 0, PPU: 0 },
  version: 1,
  createdAt: '2026-10-22T10:00:00Z',
  users,
});

describe('TimelinePeople', () => {
  let http: HttpTestingController;
  let people: TimelinePeople;
  const settle = () => new Promise((r) => setTimeout(r));

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TimelinePeople,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: APP_CONFIG, useValue: { name: 'test', apiBaseUrl: API, ssoCallbackPath: '/auth/callback' } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    people = TestBed.inject(TimelinePeople);
  });
  afterEach(() => http.verify());

  /** Loads timeline 7 with Ana as assessor and a team of Ana (assessor) and Bo (assessor + TPB). */
  const loadReady = async () => {
    const done = people.load(7);
    http.expectOne(`${API}/timelines/7`).flush(ok(detail([assignment(1, 10, 'ASSESSOR', 'Ana')])));
    http
      .expectOne((r) => r.url === `${API}/users` && r.params.get('status') === 'active')
      .flush(ok([member(10, 'Ana', [{ role: 'ASSESSOR', resultTypes: 'all' }]), member(11, 'Bo', [{ role: 'ASSESSOR', resultTypes: 'all' }, { role: 'TPB' }])]));
    await done;
  };

  it('loads who is assigned and offers only the people holding each role who are not in it yet', async () => {
    await loadReady();
    expect(people.state()).toBe('ready');
    expect(people.byRole().ASSESSOR.map((u) => u.userId)).toEqual([10]);
    expect(people.candidates('ASSESSOR').map((u) => u.id)).toEqual([11]);
    expect(people.candidates('TPB').map((u) => u.id)).toEqual([11]);
    expect(people.candidates('PPU')).toEqual([]);
    expect(people.summary()).toBe('1 assessor · 0 lead assessors · 0 brokers · 0 PPU');
  });

  it('assign: one POST with userId and role; the row shows and the person leaves the picker', async () => {
    await loadReady();
    const done = people.assign('TPB', 11);
    const req = http.expectOne(`${API}/timelines/7/users`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ userId: 11, role: 'TPB' });
    req.flush(ok(assignment(2, 11, 'TPB', 'Bo')), { status: 201, statusText: 'Created' });

    expect(await done).toBe(true);
    expect(people.byRole().TPB.map((u) => u.userId)).toEqual([11]);
    expect(people.candidates('TPB')).toEqual([]);
  });

  it('assign twice fast (double tap): only one request goes out', async () => {
    await loadReady();
    const first = people.assign('TPB', 11);
    const second = people.assign('TPB', 11);
    expect(await second).toBe(false);
    http.expectOne(`${API}/timelines/7/users`).flush(ok(assignment(2, 11, 'TPB', 'Bo')));
    expect(await first).toBe(true);
    expect(people.byRole().TPB).toHaveLength(1);
  });

  it('assign answered 200 (already assigned): still one row, no duplicate', async () => {
    await loadReady();
    const done = people.assign('ASSESSOR', 10);
    http.expectOne(`${API}/timelines/7/users`).flush(ok(assignment(1, 10, 'ASSESSOR', 'Ana')));
    await done;
    expect(people.byRole().ASSESSOR.map((u) => u.assignmentId)).toEqual([1]);
  });

  it('assign refused (409 TIMELINES_USER_NOT_ELIGIBLE): plain message under that role, nothing added', async () => {
    await loadReady();
    const done = people.assign('TPB', 11);
    http.expectOne(`${API}/timelines/7/users`).flush(fail(409, 'TIMELINES_USER_NOT_ELIGIBLE'), { status: 409, statusText: 'Conflict' });
    expect(await done).toBe(false);
    expect(people.roleError().TPB).toBe('Bo Doe is inactive or no longer holds this role.');
    expect(people.byRole().TPB).toEqual([]);
  });

  it('remove: one DELETE of that assignment; the row goes away', async () => {
    await loadReady();
    const [ana] = people.byRole().ASSESSOR;
    const done = people.remove(ana);
    const req = http.expectOne(`${API}/timelines/7/users/1`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
    expect(await done).toBe(true);
    expect(people.byRole().ASSESSOR).toEqual([]);
  });

  it('remove of an assignment already gone (404): the screen catches up, no error shown', async () => {
    await loadReady();
    const [ana] = people.byRole().ASSESSOR;
    const done = people.remove(ana);
    http.expectOne(`${API}/timelines/7/users/1`).flush(fail(404, 'TIMELINES_ASSIGNMENT_NOT_FOUND'), { status: 404, statusText: 'Not Found' });
    expect(await done).toBe(true);
    expect(people.byRole().ASSESSOR).toEqual([]);
    expect(people.roleError().ASSESSOR).toBeUndefined();
  });

  it('only the newest load paints (reopened on another timeline before the first answered)', async () => {
    const old = people.load(7);
    const fresh = people.load(8);
    const [oldDetail] = http.match(`${API}/timelines/7`);
    const [oldTeam, freshTeam] = http.match((r) => r.url === `${API}/users`);
    http.expectOne(`${API}/timelines/8`).flush(ok({ ...detail([assignment(5, 11, 'PPU', 'Bo')]), id: 8 }));
    freshTeam.flush(ok([]));
    await fresh;
    oldDetail.flush(ok(detail([assignment(1, 10, 'ASSESSOR')])));
    oldTeam.flush(ok([]));
    await old;
    await settle();
    expect(people.byRole().PPU.map((u) => u.assignmentId)).toEqual([5]);
    expect(people.byRole().ASSESSOR).toEqual([]);
  });

  it('offline (the write waits in the Unsent list): no error under the role, the Unsent list already says it', async () => {
    await loadReady();
    const done = people.assign('TPB', 11);
    http.expectOne(`${API}/timelines/7/users`).error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    expect(await done).toBe(false);
    expect(people.roleError().TPB).toBeUndefined();
  });

  it('an assignment the Unsent list sent later: the open drawer reloads in place and shows it', async () => {
    await loadReady();
    TestBed.inject(WriteEvents).recordReplay('POST', `${API}/timelines/7/users`);
    TestBed.tick();
    TestBed.tick();
    await settle();
    http.expectOne(`${API}/timelines/7`).flush(ok(detail([assignment(1, 10, 'ASSESSOR', 'Ana'), assignment(2, 11, 'TPB', 'Bo')])));
    http.expectOne((r) => r.url === `${API}/users`).flush(ok([]));
    await settle();
    expect(people.state()).toBe('ready');
    expect(people.byRole().TPB.map((u) => u.userId)).toEqual([11]);
  });

  it('a write of timeline 7 that fails after the drawer moved to timeline 8 paints no error on 8, and 8 is not busy', async () => {
    await loadReady();
    const done = people.assign('TPB', 11);
    expect(people.isAdding('TPB')).toBe(true);
    const reload = people.load(8);
    expect(people.isAdding('TPB')).toBe(false);
    http.expectOne(`${API}/timelines/8`).flush(ok({ ...detail([]), id: 8 }));
    http.expectOne((r) => r.url === `${API}/users`).flush(ok([]));
    await reload;
    http.expectOne(`${API}/timelines/7/users`).flush(fail(409, 'TIMELINES_USER_NOT_ELIGIBLE'), { status: 409, statusText: 'Conflict' });
    expect(await done).toBe(false);
    expect(people.roleError().TPB).toBeUndefined();
  });
});
