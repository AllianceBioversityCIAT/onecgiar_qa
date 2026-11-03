import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { catalogsConfig } from '../../config/catalogs.config.js';
import { getJson, isObject } from './catalog-http.js';
import { UpstreamUnavailableError } from './catalogs.errors.js';
import type {
  ScienceProgramOption,
  ScienceProgramSource,
} from './catalogs.ports.js';

/**
 * Adapter over CLARISA
 * `GET /cgiar-entities/by-portfolio?portfolioId=2,3&version=2` (settled
 * 2026-10-19 against TEST): an array of `{ id, code, name, is_active,
 * entity_type, portfolio, … }`, `id` being the canonical CLARISA id (D8).
 * Keeps the active rows. The endpoint answered the same with and without a
 * key, so none is sent. Never logs bodies (NFR-2).
 */
@Injectable()
export class ClarisaScienceProgramsClient implements ScienceProgramSource {
  private readonly logger = new Logger(ClarisaScienceProgramsClient.name);

  constructor(
    @Inject(catalogsConfig.KEY)
    private readonly config: ConfigType<typeof catalogsConfig>,
  ) {}

  async list(): Promise<ScienceProgramOption[]> {
    const base = this.config.clarisaApiUrl.replace(/\/+$/, '');
    const body = await getJson(
      'clarisa',
      `${base}/cgiar-entities/by-portfolio?portfolioId=2,3&version=2`,
      {},
      this.logger,
    );
    if (!Array.isArray(body)) {
      this.logger.warn('upstream_bad_body source=clarisa');
      throw new UpstreamUnavailableError();
    }
    const programs: ScienceProgramOption[] = [];
    for (const row of body) {
      if (
        isObject(row) &&
        row.is_active === 1 &&
        typeof row.id === 'number' &&
        typeof row.code === 'string' &&
        row.code !== '' &&
        typeof row.name === 'string' &&
        row.name.trim() !== ''
      ) {
        // Real names can carry trailing spaces.
        programs.push({
          id: row.id,
          code: row.code.trim(),
          name: row.name.trim(),
        });
      }
    }
    return programs.sort((a, b) => a.id - b.id);
  }
}
