import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { catalogsConfig } from '../../config/catalogs.config.js';
import { getJson, isObject } from './catalog-http.js';
import { UpstreamUnavailableError } from './catalogs.errors.js';
import type { ResultTypeOption, ResultTypeSource } from './catalogs.ports.js';

/**
 * Adapter over Reporting `GET /qa/catalog?phase_year=<year>` (settled
 * 2026-10-19 against TEST). The key travels in the `x-api-key` header (the
 * same key as CLARISA, per the back lead); `Authorization: Bearer` and `auth`
 * were refused with 401. Result types are the top-level `result_types` array
 * of `{ key, label, level }`; the catalog `label` is the display name. The
 * key is read from config only and never logged (NFR-2).
 */
@Injectable()
export class ReportingResultTypesClient implements ResultTypeSource {
  private readonly logger = new Logger(ReportingResultTypesClient.name);

  constructor(
    @Inject(catalogsConfig.KEY)
    private readonly config: ConfigType<typeof catalogsConfig>,
  ) {}

  async list(): Promise<ResultTypeOption[]> {
    const base = this.config.reportingApiUrl.replace(/\/+$/, '');
    const year = new Date().getUTCFullYear();
    const body = await getJson(
      'reporting',
      `${base}/qa/catalog?phase_year=${year}`,
      { 'x-api-key': this.config.apiKey },
      this.logger,
    );
    if (!isObject(body) || !Array.isArray(body.result_types)) {
      this.logger.warn('upstream_bad_body source=reporting');
      throw new UpstreamUnavailableError();
    }
    const types: ResultTypeOption[] = [];
    for (const row of body.result_types) {
      if (
        isObject(row) &&
        typeof row.key === 'string' &&
        row.key !== '' &&
        typeof row.label === 'string' &&
        row.label !== ''
      ) {
        types.push({ key: row.key, name: row.label });
      }
    }
    return types;
  }
}
