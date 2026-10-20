import { Inject, Injectable } from '@nestjs/common';
import { GRANTABLE_ROLES } from '../permissions.js';
import { UpstreamUnavailableError } from './catalogs.errors.js';
import {
  CATALOG_CLOCK,
  type GrantableRoleOption,
  RESULT_TYPE_SOURCE,
  type ResultTypeOption,
  type ResultTypeSource,
  SCIENCE_PROGRAM_SOURCE,
  type ScienceProgramOption,
  type ScienceProgramSource,
} from './catalogs.ports.js';

/** A copy younger than this is served without asking the source (DD-9). */
export const CATALOG_FRESH_MS = 60 * 60 * 1000;
/** When the source fails, a copy up to this old is still served (FR-11). */
export const CATALOG_STALE_LIMIT_MS = 24 * 60 * 60 * 1000;

interface Entry<T> {
  value: T[];
  fetchedAt: number;
}

/** Per-process cache of one catalog: fresh ≤ 1 h, stale-served ≤ 24 h on failure. */
class CachedCatalog<T> {
  private entry?: Entry<T>;
  private inFlight?: Promise<T[]>;

  constructor(
    private readonly load: () => Promise<T[]>,
    private readonly now: () => number,
  ) {}

  async get(): Promise<T[]> {
    const entry = this.entry;
    if (entry && this.now() - entry.fetchedAt < CATALOG_FRESH_MS) {
      return entry.value;
    }
    // One upstream call at a time, shared by concurrent requests.
    this.inFlight ??= this.refresh().finally(() => {
      this.inFlight = undefined;
    });
    try {
      return await this.inFlight;
    } catch (err) {
      if (
        err instanceof UpstreamUnavailableError &&
        entry &&
        this.now() - entry.fetchedAt <= CATALOG_STALE_LIMIT_MS
      ) {
        return entry.value;
      }
      throw err;
    }
  }

  private async refresh(): Promise<T[]> {
    const value = await this.load();
    this.entry = { value, fetchedAt: this.now() };
    return value;
  }
}

/**
 * The catalogs the user-management forms and validators read (design § 7,
 * DD-9): grantable roles (local), result types (Reporting) and Science
 * Programs (CLARISA), the last two cached in process.
 */
@Injectable()
export class CatalogService {
  private readonly resultTypes: CachedCatalog<ResultTypeOption>;
  private readonly sciencePrograms: CachedCatalog<ScienceProgramOption>;

  constructor(
    @Inject(RESULT_TYPE_SOURCE) resultTypeSource: ResultTypeSource,
    @Inject(SCIENCE_PROGRAM_SOURCE) programSource: ScienceProgramSource,
    @Inject(CATALOG_CLOCK) now: () => number,
  ) {
    this.resultTypes = new CachedCatalog(() => resultTypeSource.list(), now);
    this.sciencePrograms = new CachedCatalog(() => programSource.list(), now);
  }

  /** ADMIN, ASSESSOR, LEAD_ASSESSOR, TPB, PPU: PROGRAM is not grantable (D6). */
  grantableRoles(): GrantableRoleOption[] {
    return GRANTABLE_ROLES.map(({ code, name, scopeType }) => ({
      code,
      name,
      scopeType,
    }));
  }

  listResultTypes(): Promise<ResultTypeOption[]> {
    return this.resultTypes.get();
  }

  listSciencePrograms(): Promise<ScienceProgramOption[]> {
    return this.sciencePrograms.get();
  }
}
