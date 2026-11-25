// @akili-spec assessment/step-1-assessment
import { describe, expect, it } from 'vitest';
import {
  AssessmentCommentNotDeletableError,
  AssessmentCoreUncommentedError,
  AssessmentCoreCommentUndecidedError,
  AssessmentCoreUndecidedError,
  AssessmentDecisionInvalidError,
  AssessmentFieldEscalatedError,
  AssessmentFieldNotCoreError,
} from './assessment.errors.js';

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

describe('round-2 refusals (round-2 FR-3, FR-17, design 6)', () => {
  it.each([
    [new AssessmentFieldNotCoreError(), 'ASSESSMENT_FIELD_NOT_CORE'],
    [new AssessmentFieldEscalatedError(), 'ASSESSMENT_FIELD_ESCALATED'],
    [new AssessmentDecisionInvalidError(), 'ASSESSMENT_DECISION_INVALID'],
    [
      new AssessmentCommentNotDeletableError(),
      'ASSESSMENT_COMMENT_NOT_DELETABLE',
    ],
  ])('%s answers 409 with its catalog code', (error, code) => {
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({ code });
    expect(error.getResponse()).not.toHaveProperty('fields');
  });

  it('AssessmentCoreUndecidedError answers 409 and carries the field keys, in order', () => {
    const error = new AssessmentCoreUndecidedError([
      'general.title',
      'toc.outcomes',
    ]);
    expect(error.fields).toEqual(['general.title', 'toc.outcomes']);
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({
      code: 'ASSESSMENT_CORE_UNDECIDED',
      fields: ['general.title', 'toc.outcomes'],
    });
  });

  it('AssessmentCoreCommentUndecidedError answers 409 and carries the field keys', () => {
    const error = new AssessmentCoreCommentUndecidedError(['general.title']);
    expect(error.fields).toEqual(['general.title']);
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({
      code: 'ASSESSMENT_CORE_COMMENT_UNDECIDED',
      fields: ['general.title'],
    });
  });
});
