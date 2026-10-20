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

  it('edit sends only what changed, in order, and stops at the first refusal', async () => {
    users['setRoles'].mockReturnValueOnce(throwError(() => new ApiError({ status: 409, code: 'USERS_ROLE_CONFLICT', message: 'Conflict.' })));
    const outcome = await store.edit('7', input({ nick: 'New', types: ['Policy change'], programs: ['SP01'] }));
    expect(users['edit']).toHaveBeenCalledOnce();
    expect(users['setRoles']).toHaveBeenCalledOnce();
    expect(users['setPrograms']).not.toHaveBeenCalled();
    expect(outcome).toEqual({ ok: false, message: 'Conflict.', field: 'role' });
    // The nickname that did save is already on the row.
    expect(store.team()[0].nick).toBe('New');
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
