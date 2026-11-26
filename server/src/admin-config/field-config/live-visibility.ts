// @akili-spec bugfix/live-field-visibility
// Pure rule (F-005): which visibility a field reads with in a timeline that
// already started (S-13) or an assessment that already pinned a version (DD-3).
// The pinned version stays the source of truth for anything that carries
// reviewer work (Assessed, Core, AI input); a move between Hidden and View only
// in the cycle's LATEST version reaches it at once, because those fields carry
// no validation and no comment. No I/O.

import type { ConfigItem } from './field-config-diff.js';

/**
 * The pinned items of one result type, with the latest version's visibility
 * applied where both sides are Hidden or View only. A field with no item reads
 * Hidden (glossary). A field that is Assessed on either side keeps its pinned
 * item (or stays absent): a running timeline never gains or loses an Assessed
 * field. Items of other result types in either list are ignored.
 */
export function withLiveVisibility(
  resultTypeKey: string,
  pinned: readonly ConfigItem[],
  latest: readonly ConfigItem[],
): ConfigItem[] {
  const own = (items: readonly ConfigItem[]) =>
    new Map(
      items
        .filter((i) => i.resultTypeKey === resultTypeKey)
        .map((i) => [i.fieldKey, i]),
    );
  const before = own(pinned);
  const after = own(latest);
  const out: ConfigItem[] = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const kept = before.get(key);
    const visibility = after.get(key)?.visibility ?? 'hidden';
    const live =
      (kept?.visibility ?? 'hidden') !== 'assessed' &&
      visibility !== 'assessed';
    if (!live) {
      if (kept !== undefined) out.push(kept);
      continue;
    }
    out.push(
      kept === undefined
        ? {
            resultTypeKey,
            fieldKey: key,
            visibility,
            isCore: false,
            isAiInput: false,
          }
        : { ...kept, visibility },
    );
  }
  return out;
}
