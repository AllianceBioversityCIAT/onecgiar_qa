import type { Logger } from '@nestjs/common';
import { UpstreamUnavailableError } from './catalogs.errors.js';

/** Timeout of every catalog call (NFR-3: a 503 within 10 s). */
export const CATALOG_TIMEOUT_MS = 10_000;

/** Returned by `getJson` on a 404 when the caller opted in with `notFound: 'outcome'`. */
export const CATALOG_NOT_FOUND = Symbol('CATALOG_NOT_FOUND');

export interface GetJsonOptions {
  /** Default: every non-2xx is `UpstreamUnavailableError` (P-7). */
  notFound?: 'outcome';
}

export type Json = Record<string, unknown>;
export const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A non-2xx answer. It IS an `UpstreamUnavailableError` (every `getJson`
 * caller sees what it always saw) and also carries the status, so an adapter
 * that must tell 401 from other 4xx from 5xx can (ingestion FR-8). The status
 * is a number only: no body, URL or header.
 */
export class UpstreamStatusError extends UpstreamUnavailableError {
  constructor(readonly httpStatus: number) {
    super();
  }
}

/**
 * One request with the 10 s timeout. A non-2xx (`UpstreamStatusError`), a
 * network failure, a timeout or a body that is not JSON becomes
 * `UpstreamUnavailableError`; so does a 404, unless the caller opts in with
 * `notFound: 'outcome'` (then `CATALOG_NOT_FOUND`). Logs the source, the
 * status or the reason only; never a body, a URL query or a header (NFR-2).
 */
async function requestJson(
  method: 'GET' | 'POST',
  source: string,
  url: string,
  headers: Record<string, string>,
  logger: Logger,
  options: GetJsonOptions,
  body?: unknown,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
      // A redirect would forward `x-api-key` to another host: refuse it.
      redirect: 'error',
    });
    if (res.status === 404 && options.notFound === 'outcome') {
      logger.warn(`upstream_not_found source=${source}`);
      return CATALOG_NOT_FOUND;
    }
    if (!res.ok) {
      logger.warn(`upstream_unavailable source=${source} status=${res.status}`);
      throw new UpstreamStatusError(res.status);
    }
    return await res.json();
  } catch (err) {
    if (err instanceof UpstreamUnavailableError) throw err;
    logger.warn(
      `upstream_unavailable source=${source} reason=${controller.signal.aborted ? 'timeout' : 'network_or_body'}`,
    );
    throw new UpstreamUnavailableError();
  } finally {
    clearTimeout(timer);
  }
}

/** One GET with the 10 s timeout (see `requestJson`). */
export function getJson(
  source: string,
  url: string,
  headers: Record<string, string>,
  logger: Logger,
  options: GetJsonOptions = {},
): Promise<unknown> {
  return requestJson('GET', source, url, headers, logger, options);
}

/** One POST of a JSON body with the same abort, redirect refusal and log discipline as `getJson`. */
export function postJson(
  source: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  logger: Logger,
): Promise<unknown> {
  return requestJson('POST', source, url, headers, logger, {}, body ?? null);
}
