import { CatalogService } from './catalog.service.js';
import { UpstreamUnavailableError } from './catalogs.errors.js';
import type {
  ResultTypeSource,
  ScienceProgramSource,
} from './catalogs.ports.js';

const HOUR = 60 * 60 * 1000;
const TYPES = [{ key: 'KP', name: 'Knowledge product' }];
const PROGRAMS = [{ id: 1, code: 'INIT-01', name: 'Accelerated Breeding' }];

function setup() {
  const clock = { now: 1_700_000_000_000 };
  const resultTypes = { list: vi.fn<ResultTypeSource['list']>() };
  const programs = { list: vi.fn<ScienceProgramSource['list']>() };
  resultTypes.list.mockResolvedValue(TYPES);
  programs.list.mockResolvedValue(PROGRAMS);
  const service = new CatalogService(resultTypes, programs, () => clock.now);
  return { clock, resultTypes, programs, service };
}

describe('CatalogService', () => {
  describe('grantable roles', () => {
    it('lists exactly ADMIN, ASSESSOR, LEAD_ASSESSOR, TPB, PPU with scope types, never PROGRAM', () => {
      const roles = setup().service.grantableRoles();
      expect(roles.map((r) => r.code).sort()).toEqual([
        'ADMIN',
        'ASSESSOR',
        'LEAD_ASSESSOR',
        'PPU',
        'TPB',
      ]);
      expect(roles).toContainEqual({
        code: 'ASSESSOR',
        name: 'Assessor',
        scopeType: 'result_type',
      });
      expect(roles).toContainEqual({
        code: 'TPB',
        name: 'TPB',
        scopeType: 'global',
      });
    });
  });

  describe.each([
    ['result types', 'resultTypes', 'listResultTypes', TYPES],
    ['science programs', 'programs', 'listSciencePrograms', PROGRAMS],
  ] as const)('%s cache', (_name, source, method, expected) => {
    it('asks the source once while the copy is under 1 h old', async () => {
      const w = setup();
      await expect(w.service[method]()).resolves.toEqual(expected);
      w.clock.now += HOUR - 1;
      await expect(w.service[method]()).resolves.toEqual(expected);
      expect(w[source].list).toHaveBeenCalledTimes(1);
    });

    it('asks again at 1 h and keeps the new copy', async () => {
      const w = setup();
      await w.service[method]();
      w.clock.now += HOUR;
      await w.service[method]();
      expect(w[source].list).toHaveBeenCalledTimes(2);
    });

    it('serves the stale copy when the source fails, up to 24 h', async () => {
      const w = setup();
      await w.service[method]();
      w[source].list.mockRejectedValue(new UpstreamUnavailableError());
      w.clock.now += 24 * HOUR;
      await expect(w.service[method]()).resolves.toEqual(expected);
    });

    it('answers 503 when the copy is older than 24 h and the source fails', async () => {
      const w = setup();
      await w.service[method]();
      w[source].list.mockRejectedValue(new UpstreamUnavailableError());
      w.clock.now += 24 * HOUR + 1;
      await expect(w.service[method]()).rejects.toBeInstanceOf(
        UpstreamUnavailableError,
      );
    });

    it('answers 503 when the source fails and there is no copy', async () => {
      const w = setup();
      w[source].list.mockRejectedValue(new UpstreamUnavailableError());
      await expect(w.service[method]()).rejects.toBeInstanceOf(
        UpstreamUnavailableError,
      );
    });

    it('does not hide an unexpected error behind the stale copy', async () => {
      const w = setup();
      await w.service[method]();
      w[source].list.mockRejectedValue(new TypeError('bug'));
      w.clock.now += 2 * HOUR;
      await expect(w.service[method]()).rejects.toBeInstanceOf(TypeError);
    });

    it('shares one upstream call between concurrent requests', async () => {
      const w = setup();
      await Promise.all([w.service[method](), w.service[method]()]);
      expect(w[source].list).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps the two catalogs independent', async () => {
    const w = setup();
    w.programs.list.mockRejectedValue(new UpstreamUnavailableError());
    await expect(w.service.listResultTypes()).resolves.toEqual(TYPES);
    await expect(w.service.listSciencePrograms()).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
  });
});
