// @akili-spec assessment/step-1-assessment

// The end rule of an assessment (design 7.5, FR-14, FR-15): pure, over the core
// fields of the pinned field configuration. The caller (T-6) reads the facts
// under the assessment row lock and applies the outcome; nothing here touches
// a store or an HTTP error.

/** One Assessed field flagged `isCore`, as the end rule sees it. */
export interface CoreFieldState {
  key: string;
  /** Green (validated) in this assessment. */
  validated: boolean;
  /** Carries at least one non-withdrawn comment. */
  commented: boolean;
}

/** FR-15: a grey core field without a comment blocks Finish; the keys name them. */
export interface CoreUncommented {
  error: 'core_uncommented';
  fieldKeys: readonly string[];
}

export type EndOutcome =
  'quality_assessed' | 'returned' | 'none' | CoreUncommented;

/**
 * After a validation write (FR-14): with at least one core field and every core
 * field green the assessment becomes `quality_assessed`. With no core field it
 * never ends by itself ([OQ-2 default]: Finish ends it), and with a grey core
 * field it stays open.
 */
export function endAfterValidation(
  core: readonly CoreFieldState[],
): 'quality_assessed' | 'none' {
  return core.length > 0 && core.every((field) => field.validated)
    ? 'quality_assessed'
    : 'none';
}

/**
 * On Finish (FR-15, FR-14): no core field, or no grey core field, ends as
 * `quality_assessed`. Any grey core field without a non-withdrawn comment
 * refuses, naming each such field in the order given ([OQ-9 default]);
 * otherwise the assessment is `returned`.
 */
export function endOnFinish(
  core: readonly CoreFieldState[],
): 'quality_assessed' | 'returned' | CoreUncommented {
  const grey = core.filter((field) => !field.validated);
  if (grey.length === 0) return 'quality_assessed';
  const uncommented = grey.filter((field) => !field.commented);
  if (uncommented.length > 0) {
    return {
      error: 'core_uncommented',
      fieldKeys: uncommented.map((field) => field.key),
    };
  }
  return 'returned';
}
