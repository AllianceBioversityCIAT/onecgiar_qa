import type { FieldIssue } from '../../users/users.errors.js';
import { applicableFields, type FieldCatalog } from './field-config-catalog.js';

// Pure rules of a draft edit request (design 7.1, FR-4, FR-5). The request is
// already well-typed (the DTO pipe ran first). Every broken rule is returned,
// never only the first, in item order and, inside an item, in the order
// `resultTypeKey`, `fieldKey`, `isCore`, `isAiInput`. Paths are the request's
// (`items[i].<field>`); codes are catalog codes only (design 6, DD-11).

export type FieldVisibility = 'hidden' | 'view_only' | 'assessed';

/** One item of a draft edit request, already well-typed by the DTO pipe. */
export interface DraftEditItem {
  resultTypeKey: string;
  fieldKey: string;
  visibility: FieldVisibility;
  isCore?: boolean;
  isAiInput?: boolean;
}

/** Every rule a draft edit breaks, as `{ field, code }`; empty when it is valid. */
export function validateDraftEdit(
  catalog: FieldCatalog,
  items: readonly DraftEditItem[],
): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const knownTypes = new Set(catalog.resultTypes.map((t) => t.key));
  const applicableByType = new Map<string, Set<string>>();
  const applicableTo = (type: string): Set<string> => {
    let keys = applicableByType.get(type);
    if (!keys) {
      keys = new Set(applicableFields(catalog, type).map((f) => f.key));
      applicableByType.set(type, keys);
    }
    return keys;
  };
  const seen = new Set<string>();

  items.forEach((item, index) => {
    const path = `items[${index}]`;
    const typeKnown = knownTypes.has(item.resultTypeKey);
    if (!typeKnown) {
      issues.push({ field: `${path}.resultTypeKey`, code: 'INVALID' });
    }

    // A repeat is judged on the pair as sent, so a bad pair repeated twice
    // reports its field problem on both items and no second code.
    const pair = JSON.stringify([item.resultTypeKey, item.fieldKey]);
    const repeated = seen.has(pair);
    seen.add(pair);
    if (
      repeated ||
      (typeKnown && !applicableTo(item.resultTypeKey).has(item.fieldKey))
    ) {
      issues.push({ field: `${path}.fieldKey`, code: 'INVALID' });
    }

    // Flags left out never contradict: the service stores them off (FR-4).
    if (item.visibility !== 'assessed') {
      if (item.isCore === true) {
        issues.push({ field: `${path}.isCore`, code: 'NOT_ASSESSED' });
      }
      if (item.isAiInput === true) {
        issues.push({ field: `${path}.isAiInput`, code: 'NOT_ASSESSED' });
      }
    }
  });

  return issues;
}
