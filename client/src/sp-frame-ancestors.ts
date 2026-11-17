// P2-3911: who may frame the Science Program view (`/sp`). The SSR server (server.ts) sends
// `Content-Security-Policy: frame-ancestors <origins>` on `/sp` pages only, from `SP_FRAME_ANCESTORS`
// (space-separated exact Reporting origins). Unset, empty, or nothing valid: `'none'`, so `/sp`
// cannot be framed at all. Contract: docs/sp-view/reporting-integration.md § 4. Pure, no Node APIs,
// so the spec runs in the client test runner.

/**
 * The exact origin of one entry (`https://reporting.cgiar.org`), or null when it is not a bare http(s)
 * origin: no path, query, fragment, credentials or wildcard. A single trailing slash is tolerated.
 */
export function toFrameOrigin(entry: string): string | null {
  const text = entry.trim();
  if (!text || text.includes('*')) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
  // `https://host/path` already failed on pathname; `https://host?` or `#` leave no trace in URL.
  const bare = text.replace(/\/$/, '');
  if (/[?#]/.test(bare) || bare.toLowerCase() !== url.origin) return null;
  return url.origin;
}

/** The `frame-ancestors` source list: the valid origins (deduplicated), else `'none'`. */
export function frameAncestorsSources(raw: string | undefined | null): string {
  const origins = [...new Set((raw ?? '').split(/\s+/).map(toFrameOrigin).filter((o): o is string => o !== null))];
  return origins.length ? origins.join(' ') : "'none'";
}

/** The whole header value for `/sp` pages. */
export function spFrameAncestorsPolicy(raw: string | undefined | null): string {
  return `frame-ancestors ${frameAncestorsSources(raw)}`;
}

/** `/sp`, `/sp/…` (query aside). Not `/sports` or `/spa`. */
export function isSpPath(path: string): boolean {
  const pathname = path.split(/[?#]/)[0];
  return pathname === '/sp' || pathname.startsWith('/sp/');
}
