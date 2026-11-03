/**
 * Effective scope (design section 7, D5, DD-1): role -> result types ->
 * program scope minus active exclusions. Pure: the inputs are what
 * `CurrentUserCache` loads with the user (T-4), nothing here reads a store.
 */

/** `result_type_key` value meaning every result type, current and future (DD-1). */
export const ALL_RESULT_TYPES = '*';

/** `user_program_exclusions.status` (design section 5, DD-12). */
export type ExclusionStatus = 'active' | 'removed' | 'dismissed';

export interface ProgramExclusionView {
  programId: number;
  status: ExclusionStatus;
}

export interface ProgramScopeView {
  /** `user_programs` rows of the user; empty = all programs, future ones too. */
  programScope: readonly number[];
  /** Every exclusion row loaded; only `active` ones exclude (DD-12). */
  exclusions: readonly ProgramExclusionView[];
}

/** Does a grant's `result_type_key` cover the result type of a resource? */
export function coversResultType(
  grantKey: string | null,
  resultType: string | null | undefined,
): boolean {
  if (!grantKey || !resultType) return false;
  return grantKey === ALL_RESULT_TYPES || grantKey === resultType;
}

/** Can two grants' result type keys ever cover the same result type? */
export function resultTypeKeysOverlap(a: string, b: string): boolean {
  return a === ALL_RESULT_TYPES || b === ALL_RESULT_TYPES || a === b;
}

/**
 * Is `programId` inside the user's program scope, exclusions applied? Both
 * parts are required: a subject whose scope was never loaded must not compile,
 * rather than read as "all programs" and pass (fail closed by type).
 */
export function coversProgram(
  scope: ProgramScopeView,
  programId: number | null | undefined,
): boolean {
  if (programId === null || programId === undefined) return false;
  const excluded = scope.exclusions.some(
    (exclusion) =>
      exclusion.status === 'active' && exclusion.programId === programId,
  );
  if (excluded) return false;
  return (
    scope.programScope.length === 0 || scope.programScope.includes(programId)
  );
}
