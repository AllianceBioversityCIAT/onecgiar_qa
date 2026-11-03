import { createHash } from 'node:crypto';

export interface FingerprintInput {
  method: string;
  /** The request path as received: ids included, any query string or fragment is dropped. */
  path: string;
  /** The parsed JSON body; `undefined` (no body) counts as `null`. */
  body: unknown;
}

/**
 * Canonical JSON: object keys sorted recursively, array order kept, no
 * whitespace. Built as a string rather than as a rebuilt object so an own
 * `"__proto__"` key stays data. Values JSON cannot carry follow JSON.stringify
 * (skipped in objects, `null` in arrays); a body parsed from JSON has none.
 */
function canonical(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonical(item) ?? 'null').join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const members: string[] = [];
    for (const key of Object.keys(record).sort()) {
      const member = canonical(record[key]);
      if (member !== undefined)
        members.push(`${JSON.stringify(key)}:${member}`);
    }
    return `{${members.join(',')}}`;
  }
  return JSON.stringify(value) as string | undefined;
}

/**
 * FR-4: sha256 of method + path + canonical body, newline-separated. Two
 * requests are "the same" exactly when this matches; the `Idempotency-Key`
 * header is not an input. The query string is excluded on purpose (design 7,
 * Fingerprint): the users-admin writes take no query parameters.
 */
export function requestFingerprint({
  method,
  path,
  body,
}: FingerprintInput): string {
  const pathname = path.split(/[?#]/, 1)[0] as string;
  const canonicalBody = canonical(body === undefined ? null : body);
  return createHash('sha256')
    .update(`${method.toUpperCase()}\n${pathname}\n${canonicalBody}`)
    .digest('hex');
}
