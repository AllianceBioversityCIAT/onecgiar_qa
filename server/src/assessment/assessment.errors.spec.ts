// @akili-spec assessment/step-1-assessment
import { describe, expect, it } from 'vitest';
import { AssessmentCoreUncommentedError } from './assessment.errors.js';

describe('AssessmentCoreUncommentedError (FR-15, design 6)', () => {
  it('carries the field keys it was given, in order, for the 409 response details', () => {
    const error = new AssessmentCoreUncommentedError([
      'general.title',
      'toc.outcomes',
    ]);
    expect(error.fields).toEqual(['general.title', 'toc.outcomes']);
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({
      code: 'ASSESSMENT_CORE_UNCOMMENTED',
    });
  });
});
