/**
 * F-022 (Juanda, 24-nov-2026): one evidence of a result, as the assessor should read it. Reporting sends each
 * evidence with 12 `*_related` flags, `is_public_file` and `description`; read as "Is public file: No · … ·
 * Description: …" they buried the link. Here the flags go, a non-public file reads "(Private)" beside its link
 * (after a no-break space, so a phone never wraps it away from the link), and `description` (where the proof sits
 * in the file or link) reads "Where to find it".
 * Any other object is returned as it came.
 */
const RELATED_FLAG = /_related(_flag)?$/;

const isEvidence = (entry: Readonly<Record<string, unknown>>): boolean =>
  Object.hasOwn(entry, 'is_public_file') || Object.keys(entry).some((k) => RELATED_FLAG.test(k));

const filled = (v: unknown): boolean => v !== null && v !== undefined && v !== '';

export function evidenceEntry(entry: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  if (!isEvidence(entry)) return entry;
  const isPrivate = entry['is_public_file'] === false;
  // The link the tag sits beside: `link`, else the uploaded file's `file_url`.
  const linkKey = filled(entry['link']) ? 'link' : filled(entry['file_url']) ? 'file_url' : null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(entry)) {
    if (RELATED_FLAG.test(k) || k === 'is_public_file') continue;
    if (k === 'description') out['where_to_find_it'] = v;
    else out[k] = isPrivate && k === linkKey ? `${String(v)}\u00a0(Private)` : v;
  }
  if (isPrivate && !linkKey) out['access'] = 'Private';
  return out;
}
