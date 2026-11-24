// @akili-spec ingestion/step-1-loads
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { catalogsConfig } from '../config/catalogs.config.js';
import {
  getJson,
  isObject,
  postJson,
  UpstreamStatusError,
  type Json,
} from '../users/catalogs/catalog-http.js';
import {
  FeedError,
  type FeedDetails,
  type FeedDetailsQuery,
  type FeedIntake,
  type FeedIntakeQuery,
  type FeedListQuery,
  type FeedPage,
  type FeedRelease,
  type FeedReleaseQuery,
  type ReleaseOutcome,
  type ResultsFeed,
} from './results-feed.port.js';

/** A body that is not the contract's shape. Never escapes this file. */
class BadShape extends Error {}

const bad = (): never => {
  throw new BadShape();
};
const obj = (v: unknown): Json => (isObject(v) ? v : bad());
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : bad());
const int = (v: unknown): number =>
  Number.isInteger(v) ? (v as number) : bad();
const str = (v: unknown): string => (typeof v === 'string' ? v : bad());
const bool = (v: unknown): boolean => (typeof v === 'boolean' ? v : bad());
const intOrNull = (v: unknown): number | null => (v === null ? null : int(v));
const strOrNull = (v: unknown): string | null => (v === null ? null : str(v));
const outcome = (v: unknown): ReleaseOutcome =>
  v === 'qaed' || v === 'not_qaed' ? v : bad();

/**
 * Adapter over Reporting `GET /qa/results`, `POST /qa/results/details`,
 * `/intake` and `/release` (contract v1.29). The key travels in `x-api-key`
 * only; it is read from config and never logged (NFR-1). Every call has the
 * 10 s timeout of `catalog-http.ts` (NFR-4). Failures are one `FeedError`;
 * a body that does not match the contract, field by field, is `unavailable`.
 */
@Injectable()
export class ReportingResultsFeedClient implements ResultsFeed {
  private readonly logger = new Logger(ReportingResultsFeedClient.name);

  constructor(
    @Inject(catalogsConfig.KEY)
    private readonly config: ConfigType<typeof catalogsConfig>,
  ) {}

  list(query: FeedListQuery): Promise<FeedPage> {
    const params = new URLSearchParams({ phase_year: String(query.phaseYear) });
    if (query.programIds?.length)
      params.set('program_ids', query.programIds.join(','));
    if (query.resultTypeKeys?.length)
      params.set('result_type_keys', query.resultTypeKeys.join(','));
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.pageSize !== undefined)
      params.set('page_size', String(query.pageSize));
    return this.run(
      () =>
        getJson(
          'reporting',
          `${this.base()}/qa/results?${params.toString()}`,
          this.headers(),
          this.logger,
        ),
      parsePage,
    );
  }

  details(query: FeedDetailsQuery): Promise<FeedDetails> {
    return this.run(
      () =>
        this.post('/qa/results/details', {
          phase_year: query.phaseYear,
          result_ids: query.resultIds,
          ...(query.fieldKeys ? { field_keys: query.fieldKeys } : {}),
        }),
      parseDetails,
    );
  }

  intake(query: FeedIntakeQuery): Promise<FeedIntake> {
    return this.run(
      () =>
        this.post('/qa/results/intake', {
          phase_year: query.phaseYear,
          result_ids: query.resultIds,
        }),
      parseIntake,
    );
  }

  release(query: FeedReleaseQuery): Promise<FeedRelease> {
    return this.run(
      () =>
        this.post('/qa/results/release', {
          phase_year: query.phaseYear,
          items: query.items.map((i) => ({
            result_id: i.resultId,
            outcome: i.outcome,
          })),
        }),
      parseRelease,
    );
  }

  private base(): string {
    return this.config.reportingApiUrl.replace(/\/+$/, '');
  }

  private headers(): Record<string, string> {
    return { 'x-api-key': this.config.apiKey };
  }

  private post(path: string, body: unknown): Promise<unknown> {
    return postJson(
      'reporting',
      `${this.base()}${path}`,
      this.headers(),
      body,
      this.logger,
    );
  }

  /** Call, map the failure to a `FeedError`, parse the body field by field. */
  private async run<T>(
    call: () => Promise<unknown>,
    parse: (body: unknown) => T,
  ): Promise<T> {
    let body: unknown;
    try {
      body = await call();
    } catch (err) {
      if (err instanceof UpstreamStatusError) {
        if (err.httpStatus === 401) throw new FeedError('unauthorized');
        if (err.httpStatus >= 400 && err.httpStatus < 500)
          throw new FeedError('rejected', err.httpStatus);
      }
      throw new FeedError('unavailable');
    }
    try {
      return parse(body);
    } catch (err) {
      if (!(err instanceof BadShape)) throw err;
      this.logger.warn('upstream_bad_body source=reporting');
      throw new FeedError('unavailable');
    }
  }
}

function parsePage(body: unknown): FeedPage {
  const b = obj(body);
  const breakdown = obj(b.breakdown);
  return {
    phase: int(b.phase),
    page: int(b.page),
    pageSize: int(b.page_size),
    total: int(b.total),
    breakdown: {
      byProgram: arr(breakdown.by_program).map((r) => {
        const o = obj(r);
        return {
          clarisaId: int(o.clarisa_id),
          code: str(o.code),
          count: int(o.count),
        };
      }),
      byResultType: arr(breakdown.by_result_type).map((r) => {
        const o = obj(r);
        return { key: str(o.key), count: int(o.count) };
      }),
    },
    items: arr(b.items).map((r) => {
      const o = obj(r);
      const program = obj(o.program);
      return {
        resultId: int(o.result_id),
        resultCode: int(o.result_code),
        program: {
          clarisaId: int(program.clarisa_id),
          code: str(program.code),
        },
        resultTypeKey: str(o.result_type_key),
        submittedAt: strOrNull(o.submitted_at),
      };
    }),
  };
}

function parseDetails(body: unknown): FeedDetails {
  const b = obj(body);
  return {
    phase: int(b.phase),
    catalogVersion: str(b.catalog_version),
    results: arr(b.results).map((r) => {
      const o = obj(r);
      return {
        resultId: int(o.result_id),
        resultCode: int(o.result_code),
        resultTypeKey: str(o.result_type_key),
        values: obj(o.values),
      };
    }),
    notEligible: arr(b.not_eligible).map((r) => {
      const o = obj(r);
      return { resultId: int(o.result_id), reason: str(o.reason) };
    }),
  };
}

function parseIntake(body: unknown): FeedIntake {
  const b = obj(body);
  return {
    phaseYear: int(b.phase_year),
    taken: arr(b.taken).map((r) => {
      const o = obj(r);
      return {
        resultId: int(o.result_id),
        resultCode: int(o.result_code),
        changed: bool(o.changed),
      };
    }),
    notTaken: arr(b.not_taken).map((r) => {
      const o = obj(r);
      return {
        resultId: int(o.result_id),
        resultCode: intOrNull(o.result_code),
        reason: str(o.reason),
      };
    }),
  };
}

function parseRelease(body: unknown): FeedRelease {
  const b = obj(body);
  return {
    phaseYear: int(b.phase_year),
    released: arr(b.released).map((r) => {
      const o = obj(r);
      return {
        resultId: int(o.result_id),
        resultCode: int(o.result_code),
        outcome: outcome(o.outcome),
      };
    }),
    notReleased: arr(b.not_released).map((r) => {
      const o = obj(r);
      return {
        resultId: int(o.result_id),
        resultCode: intOrNull(o.result_code),
        reason: str(o.reason),
      };
    }),
  };
}
