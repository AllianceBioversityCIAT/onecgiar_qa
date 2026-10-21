import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { CatalogsApi } from '../../../core/api/catalogs-api';
import { UsersApi } from '../../../core/api/users-api';
import { UserSummary } from '../../../core/api/users.models';
import { ApiError } from '../../../core/http/api-envelope';
import { Toasts } from '../../../core/http/toasts';
import { AssessorsStore, PersonInput } from './assessors-store';

const u = (over: Partial<UserSummary> = {}): UserSummary => ({
  id: 7,
  email: 'ada@cgiar.org',
  firstName: 'Ada',
  lastName: 'Lovelace',
  nickname: 'Assessor AL',
  accountType: 'sso',
  status: 'active',
  lastSignInAt: null,
  invitation: 'none',
  roles: [{ role: 'ASSESSOR', resultTypes: ['kp'] }],
  programs: 'all',
  exclusions: [],
  ...over,
});
const detail = (over: Partial<UserSummary> = {}) => ({ ...u(over), exclusionHistory: [] });

const input = (over: Partial<PersonInput> = {}): PersonInput => ({
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@cgiar.org',
  nick: 'Assessor AL',
  role: 'Assessor',
  lead: false,
  types: ['Knowledge product'],
  programs: [],
  blocked: [],
  ...over,
});

describe('AssessorsStore', () => {
  let users: Record<string, ReturnType<typeof vi.fn>>;
  let store: AssessorsStore;

  beforeEach(async () => {
    users = {
      listAll: vi.fn(() => of([u()])),
      create: vi.fn(() => of(detail({ id: 8, email: 'bo@x.org', accountType: 'custom', invitation: 'sent' }))),
      edit: vi.fn(() => of(detail({ nickname: 'New' }))),
      replace: vi.fn(() => of(detail({ nickname: 'New' }))),
      setRoles: vi.fn(() => of(detail())),
      setPrograms: vi.fn(() => of(detail())),
      addExclusion: vi.fn(() => of(detail())),
      removeExclusion: vi.fn(() => of(detail())),
      deactivate: vi.fn(() => of(detail({ status: 'inactive' }))),
    };
    TestBed.configureTestingModule({
      providers: [
        AssessorsStore,
        { provide: UsersApi, useValue: users },
        {
          provide: CatalogsApi,
          useValue: {
            resultTypes: () => of([{ key: 'kp', name: 'Knowledge product' }, { key: 'pc', name: 'Policy change' }]),
            sciencePrograms: () => of([{ id: 441, code: 'SP01', name: 'Breeding' }]),
          },
        },
        { provide: Toasts, useValue: { error: vi.fn(), success: vi.fn(), info: vi.fn() } },
      ],
    });
    store = TestBed.inject(AssessorsStore);
    await store.load();
  });

  it('loads catalogs and the whole team', () => {
    expect(store.state()).toBe('ready');
    expect(store.typeNames()).toEqual(['Knowledge product', 'Policy change']);
    expect(store.team().map((m) => m.name)).toEqual(['Ada Lovelace']);
  });

  it('programs down (CLARISA 503): the team still loads, only programs are flagged missing', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        AssessorsStore,
        { provide: UsersApi, useValue: users },
        {
          provide: CatalogsApi,
          useValue: {
            resultTypes: () => of([{ key: 'kp', name: 'Knowledge product' }]),
            sciencePrograms: () => throwError(() => new ApiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Down.' })),
          },
        },
        { provide: Toasts, useValue: { error: vi.fn(), success: vi.fn(), info: vi.fn() } },
      ],
    });
    const s2 = TestBed.inject(AssessorsStore);
    await s2.load();
    expect(s2.state()).toBe('ready');
    expect(s2.missingCatalogs()).toEqual(['programs']);
    expect(s2.team().length).toBe(1);
  });

  it('a failed load shows the server message and can be retried', async () => {
    users['listAll'].mockReturnValueOnce(throwError(() => new ApiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'CLARISA is down.' })));
    await store.load();
    expect(store.state()).toBe('error');
    expect(store.loadError()).toBe('CLARISA is down.');
  });

  it('invite sends names apart, account type by email and mapped roles, then adds the row', async () => {
    const outcome = await store.invite(input({ email: 'bo@x.org', firstName: 'Bo', lastName: 'Li', nick: 'BL', programs: ['SP01'] }));
    expect(outcome).toEqual({ ok: true });
    expect(users['create']).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: 'Bo',
        lastName: 'Li',
        accountType: 'custom',
        roles: [{ role: 'ASSESSOR', resultTypes: ['kp'] }],
        programs: [441],
        exclusions: [],
      }),
    );
    expect(store.team().length).toBe(2);
  });

  it('a taken nickname comes back on the nickname field', async () => {
    users['create'].mockReturnValueOnce(throwError(() => new ApiError({ status: 409, code: 'USERS_NICKNAME_TAKEN', message: 'That nickname is taken.' })));
    expect(await store.invite(input())).toEqual({ ok: false, message: 'That nickname is taken.', field: 'nick' });
  });

  it('a retry after a lost answer that says "email taken" counts as created and reloads', async () => {
    users['create']
      .mockReturnValueOnce(throwError(() => new ApiError({ status: 0, code: 'CLIENT_NETWORK_ERROR', message: 'Offline.' })))
      .mockReturnValueOnce(throwError(() => new ApiError({ status: 409, code: 'USERS_EMAIL_TAKEN', message: 'Taken.' })));
    expect((await store.invite(input({ email: 'bo@x.org' }))).ok).toBe(false);
    expect(await store.invite(input({ email: 'bo@x.org' }))).toEqual({ ok: true });
    expect(users['listAll']).toHaveBeenCalledTimes(2);
  });

  it('"email taken" without a lost answer before is a real conflict on the email field', async () => {
    users['create'].mockReturnValueOnce(throwError(() => new ApiError({ status: 409, code: 'USERS_EMAIL_TAKEN', message: 'Taken.' })));
    expect(await store.invite(input())).toEqual({ ok: false, message: 'Taken.', field: 'email' });
  });

  it('edit saves the whole person in ONE PUT; a refusal changes nothing on the row', async () => {
    users['replace'].mockReturnValueOnce(throwError(() => new ApiError({ status: 409, code: 'USERS_ROLE_CONFLICT', message: 'Conflict.' })));
    const outcome = await store.edit('7', input({ nick: 'New', types: ['Policy change'], programs: ['SP01'] }));
    expect(users['replace']).toHaveBeenCalledOnce();
    expect(users['replace'].mock.calls[0][1]).toEqual({
      nickname: 'New',
      roles: [{ role: 'ASSESSOR', resultTypes: ['pc'] }],
      programs: [441],
      exclusions: [],
    });
    for (const k of ['edit', 'setRoles', 'setPrograms', 'addExclusion', 'removeExclusion']) expect(users[k]).not.toHaveBeenCalled();
    expect(outcome).toEqual({ ok: false, message: 'Conflict.', field: 'role' });
    expect(store.team()[0].nick).toBe('Assessor AL');
  });

  it('only the nickname of a Lead assessor with other roles changes: the server grants go back untouched', async () => {
    users['listAll'].mockReturnValueOnce(of([u({ roles: [{ role: 'LEAD_ASSESSOR', resultTypes: 'all' }, { role: 'TPB' }] })]));
    await store.load();
    await store.edit('7', input({ role: 'Lead assessor', lead: false, types: [], nick: 'New' }));
    expect(users['replace'].mock.calls[0][1].roles).toEqual([{ role: 'LEAD_ASSESSOR', resultTypes: 'all' }, { role: 'TPB' }]);
  });

  it('blocking their only program is refused instead of widening to all programs', async () => {
    users['listAll'].mockReturnValueOnce(of([u({ programs: [441] })]));
    await store.load();
    const outcome = await store.edit('7', input({ programs: [], blocked: [{ code: 'SP01', reason: 'Co-author' }] }));
    expect(outcome).toMatchObject({ ok: false, field: 'programs' });
    expect(users['replace']).not.toHaveBeenCalled();
  });

  it('reporting exclusions are never sent; manual ones are the complete set', async () => {
    users['listAll'].mockReturnValueOnce(
      of([u({ programs: 'all', exclusions: [{ id: 5, programId: 441, origin: 'reporting', reason: null, since: '2026-02-12T00:00:00Z' }] })]),
    );
    await store.load();
    await store.edit('7', input({ nick: 'New', blocked: [{ code: 'SP01', reason: '', id: 5 }] }));
    expect(users['replace'].mock.calls[0][1].exclusions).toEqual([]);
  });

  it('an assessor without result types is refused (it would revoke every grant)', async () => {
    expect(await store.invite(input({ types: [] }))).toMatchObject({ ok: false, field: 'types' });
    expect(await store.edit('7', input({ types: [] }))).toMatchObject({ ok: false, field: 'types' });
    await store.setTypes('7', []);
    expect(users['setRoles']).not.toHaveBeenCalled();
    expect(users['replace']).not.toHaveBeenCalled();
  });

  it('a gateway timeout (504 without envelope) on invite also counts as a lost answer', async () => {
    users['create']
      .mockReturnValueOnce(throwError(() => new ApiError({ status: 504, code: 'CLIENT_UNEXPECTED_RESPONSE', message: 'x' })))
      .mockReturnValueOnce(throwError(() => new ApiError({ status: 409, code: 'USERS_EMAIL_TAKEN', message: 'Taken.' })));
    await store.invite(input({ email: 'bo@x.org' }));
    expect(await store.invite(input({ email: 'bo@x.org' }))).toEqual({ ok: true });
  });

  it('two quick inline type changes: the second waits for the first (no lost update)', async () => {
    let release!: () => void;
    users['setRoles'].mockReturnValueOnce(
      new (await import('rxjs')).Observable((sub) => {
        release = () => {
          sub.next(detail({ roles: [{ role: 'ASSESSOR', resultTypes: ['kp', 'pc'] }] }));
          sub.complete();
        };
      }),
    );
    const first = store.setTypes('7', ['Knowledge product', 'Policy change']);
    expect(store.isBusy('7')).toBe(true);
    await store.setTypes('7', ['Knowledge product']);
    expect(users['setRoles']).toHaveBeenCalledOnce();
    release();
    await first;
    expect(store.isBusy('7')).toBe(false);
  });

  it('nothing changed: no call at all', async () => {
    await store.edit('7', input());
    for (const fn of Object.values(users)) if (fn !== users['listAll']) expect(fn).not.toHaveBeenCalled();
  });

  it('remove = deactivate; the person leaves the team list', async () => {
    expect(await store.deactivate('7')).toEqual({ ok: true });
    expect(store.team().length).toBe(0);
  });
});
