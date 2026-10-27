// Pure diff of a timeline edit (timeline-edit design 7.1, 5). `diffTimeline`
// turns the stored state and the merged state into the audit `changes` map:
// one `{ before, after }` per field that differs, nothing else (FR-10). The
// same map decides the no-op (FR-11) and the in-progress confirmation (FR-8),
// so it is the one place that says what "changed" means.

export interface TimelineSnapshotStep {
  position: number;
  name: string;
  /** A moment, `YYYY-MM-DDTHH:mm`: what changed is judged by it (FR-9). */
  opensAt?: string | null;
  closesAt?: string | null;
}

/** The fields an edit can change, in the shape both sides of the diff share. */
export interface TimelineSnapshot {
  name: string;
  allPrograms: boolean;
  programIds: readonly number[];
  allResultTypes: boolean;
  resultTypeKeys: readonly string[];
  steps: readonly TimelineSnapshotStep[];
}

export type ChangeValue =
  string | boolean | null | readonly (string | number)[];

/**
 * `{ "<field>": { before, after } }`. Keys: `name`, `allPrograms`,
 * `programIds`, `allResultTypes`, `resultTypeKeys` and
 * `steps.<position>.<name|opensOn|closesOn>`. Lists are sorted, so the same set
 * in another order is not a change. A step boundary is compared by its moment
 * and recorded as its day under the existing key: the audit keys move to the
 * moment itself with the API (timeline-step-times FR-12, a later task).
 */
export type TimelineChanges = Record<
  string,
  { before: ChangeValue; after: ChangeValue }
>;

type Scalar = string | boolean | null | undefined;

/** The changed fields between the stored and the merged state; `{}` when none. */
export function diffTimeline(
  stored: TimelineSnapshot,
  merged: TimelineSnapshot,
): TimelineChanges {
  const changes: TimelineChanges = {};

  const scalar = (key: string, before: Scalar, after: Scalar): void => {
    if ((before ?? null) !== (after ?? null)) {
      changes[key] = { before: before ?? null, after: after ?? null };
    }
  };
  const day = (key: string, before: Scalar, after: Scalar): void => {
    if ((before ?? null) !== (after ?? null)) {
      changes[key] = { before: dayPart(before), after: dayPart(after) };
    }
  };
  const list = <T extends string | number>(
    key: string,
    before: readonly T[],
    after: readonly T[],
  ): void => {
    const sortedBefore = sorted(before);
    const sortedAfter = sorted(after);
    if (!sameItems(sortedBefore, sortedAfter)) {
      changes[key] = { before: sortedBefore, after: sortedAfter };
    }
  };

  scalar('name', stored.name, merged.name);
  scalar('allPrograms', stored.allPrograms, merged.allPrograms);
  list('programIds', stored.programIds, merged.programIds);
  scalar('allResultTypes', stored.allResultTypes, merged.allResultTypes);
  list('resultTypeKeys', stored.resultTypeKeys, merged.resultTypeKeys);

  const storedByPosition = new Map(stored.steps.map((s) => [s.position, s]));
  const byPosition = [...merged.steps].sort((a, b) => a.position - b.position);
  for (const step of byPosition) {
    const before = storedByPosition.get(step.position);
    const prefix = `steps.${step.position}`;
    scalar(`${prefix}.name`, before?.name, step.name);
    day(`${prefix}.opensOn`, before?.opensAt, step.opensAt);
    day(`${prefix}.closesOn`, before?.closesAt, step.closesAt);
  }

  return changes;
}

/** The `YYYY-MM-DD` part of a moment, or null when there is none. */
function dayPart(moment: Scalar): string | null {
  return typeof moment === 'string' ? moment.slice(0, 10) : null;
}

/** A sorted copy; numbers by value, strings by code unit, never mutating the input. */
function sorted<T extends string | number>(items: readonly T[]): T[] {
  return [...new Set(items)].sort((a, b) =>
    typeof a === 'number' && typeof b === 'number'
      ? a - b
      : String(a) < String(b)
        ? -1
        : String(a) > String(b)
          ? 1
          : 0,
  );
}

function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}
