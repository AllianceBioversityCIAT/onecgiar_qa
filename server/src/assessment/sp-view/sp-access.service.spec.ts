import { InMemorySpAccessStore } from '../../../test/support/in-memory-sp.js';
import type { CatalogService } from '../../users/catalogs/catalog.service.js';
import { SpAccessService } from './sp-access.service.js';
import { sha256Hex } from './sp-tokens.js';

const PROGRAMS = [
  { id: 11, code: 'SP01', name: 'One' },
  { id: 12, code: 'SP02', name: 'Two' },
];

describe('SpAccessService (P2-3911)', () => {
  let store: InMemorySpAccessStore;
  let now: Date;
  let service: SpAccessService;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    store = new InMemorySpAccessStore();
    now = new Date('2026-11-17T10:00:00.000Z');
    const catalog = {
      listSciencePrograms: () => Promise.resolve(PROGRAMS),
    } as unknown as CatalogService;
    service = new SpAccessService(store, catalog, () => now);
  });

  afterEach(() => vi.restoreAllMocks());

  const input = {
    email: 'SP-User@Example.org',
    name: 'Sam',
    programCode: 'sp02',
    isReportingAdmin: false,
  };

  it('stores the hash of the code, the CLARISA id and an expiry 60 s ahead', async () => {
    const issued = await service.issueCode(input, 'r1');
    expect(issued.expiresAt).toBe('2026-11-17T10:01:00.000Z');
    expect(store.codes[0]).toMatchObject({
      codeHash: sha256Hex(issued.code),
      email: 'sp-user@example.org',
      programId: 12,
      isReportingAdmin: false,
    });
  });

  it('refuses an unknown program, and a null program for a non-admin', async () => {
    await expect(
      service.issueCode({ ...input, programCode: 'SP03' }, 'r'),
    ).rejects.toMatchObject({ response: { code: 'SP_PROGRAM_UNKNOWN' } });
    await expect(
      service.issueCode({ ...input, programCode: null }, 'r'),
    ).rejects.toMatchObject({ response: { code: 'SP_PROGRAM_UNKNOWN' } });
    expect(store.codes).toEqual([]);
  });

  it('exchanges a code once, for an 8 h session', async () => {
    const { code } = await service.issueCode(input, 'r');
    const session = await service.exchange(code, 'r');
    expect(session).toMatchObject({
      expiresAt: '2026-11-17T18:00:00.000Z',
      program: { id: 12, code: 'SP02', name: 'Two' },
      user: { name: 'Sam' },
    });
    expect(store.sessions[0]!.tokenHash).toBe(sha256Hex(session.accessToken));
    await expect(service.exchange(code, 'r')).rejects.toMatchObject({
      response: { code: 'SP_CODE_INVALID' },
    });
  });

  it('refuses a code after 60 s', async () => {
    const { code } = await service.issueCode(input, 'r');
    now = new Date('2026-11-17T10:01:00.001Z');
    await expect(service.exchange(code, 'r')).rejects.toMatchObject({
      response: { code: 'SP_CODE_INVALID' },
    });
  });

  it('lists every program for an admin and only its own otherwise', async () => {
    const base = { id: 1, email: 'x@example.org', name: 'Sam' };
    expect(
      (await service.me({ ...base, programId: 12, isReportingAdmin: false }))
        .programs,
    ).toEqual([{ id: 12, code: 'SP02', name: 'Two' }]);
    expect(
      (await service.me({ ...base, programId: null, isReportingAdmin: true }))
        .programs,
    ).toHaveLength(2);
  });
});
