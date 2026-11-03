import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { catalogsConfig } from '../../config/catalogs.config.js';
import {
  CATALOG_NOT_FOUND,
  getJson,
} from '../../users/catalogs/catalog-http.js';
import {
  CATALOG_FRESH_MS,
  CATALOG_STALE_LIMIT_MS,
} from '../../users/catalogs/catalog.service.js';
import { UpstreamUnavailableError } from '../../users/catalogs/catalogs.errors.js';
import {
  ADMIN_CONFIG_CLOCK,
  type AdminConfigClock,
} from '../admin-config.clock.js';
import {
  FieldCatalogMissingError,
  type FieldCatalogSource,
} from './field-catalog.ports.js';
import { type FieldCatalog, shapeCatalog } from './field-config-catalog.js';

interface Entry {
  value: FieldCatalog;
  fetchedAt: number;
}

/**
 * Adapter over Reporting `GET /qa/catalog?phase_year=<year>` (design 7.4): the
 * same URL and `x-api-key` as `ReportingResultTypesClient`, but the year is
 * the caller's (the cycle's), never the clock's. A 404 is
 * `FieldCatalogMissingError`; every other failure is `UpstreamUnavailableError`.
 * The cache is one entry per year with the policy of `CatalogService`: fresh
 * 1 h, a copy up to 24 h old served when Reporting fails. A 404 is never stored
 * and is not covered by a stale copy. The key is never logged (NFR-2).
 */
@Injectable()
export class ReportingQaCatalogClient implements FieldCatalogSource {
  private readonly logger = new Logger(ReportingQaCatalogClient.name);
  private readonly entries = new Map<number, Entry>();
  private readonly inFlight = new Map<number, Promise<FieldCatalog>>();

  constructor(
    @Inject(catalogsConfig.KEY)
    private readonly config: ConfigType<typeof catalogsConfig>,
    @Inject(ADMIN_CONFIG_CLOCK) private readonly clock: AdminConfigClock,
  ) {}

  async forYear(year: number): Promise<FieldCatalog> {
    const entry = this.entries.get(year);
    if (entry && this.now() - entry.fetchedAt < CATALOG_FRESH_MS) {
      return entry.value;
    }
    // One upstream call per year at a time, shared by concurrent requests.
    let pending = this.inFlight.get(year);
    if (!pending) {
      pending = this.refresh(year).finally(() => {
        this.inFlight.delete(year);
      });
      this.inFlight.set(year, pending);
    }
    try {
      return await pending;
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

  private now(): number {
    return this.clock().getTime();
  }

  private async refresh(year: number): Promise<FieldCatalog> {
    const base = this.config.reportingApiUrl.replace(/\/+$/, '');
    const body = await getJson(
      'reporting',
      `${base}/qa/catalog?phase_year=${year}`,
      { 'x-api-key': this.config.apiKey },
      this.logger,
      { notFound: 'outcome' },
    );
    if (body === CATALOG_NOT_FOUND) throw new FieldCatalogMissingError(year);
    const value = shapeCatalog(body);
    this.entries.set(year, { value, fetchedAt: this.now() });
    return value;
  }
}
