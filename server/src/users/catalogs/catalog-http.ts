import type { Logger } from '@nestjs/common';
import { UpstreamUnavailableError } from './catalogs.errors.js';

/** Timeout of every catalog call (NFR-3: a 503 within 10 s). */
export const CATALOG_TIMEOUT_MS = 10_000;

export type Json = Record<string, unknown>;
export const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * One GET with the 10 s timeout. A non-2xx, a network failure, a timeout or a
 * body that is not JSON becomes `UpstreamUnavailableError`. Logs the source,
 * the status or the reason only; never a body, a URL query or a header (NFR-2).
 */
export async function getJson(
  source: string,
  url: string,
  headers: Record<string, string>,
  logger: Logger,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json', ...headers },
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn(`upstream_unavailable source=${source} status=${res.status}`);
      throw new UpstreamUnavailableError();
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
