import { commentStates } from '../../database/drizzle/schema/assessment-comments.js';
import { programSideState, REVIEW_STATES } from './sp-state.js';

// DD-11: the program never reads a review state; it reads the state its latest response implies.
describe('programSideState (DD-11)', () => {
  const cases = [
    [null, 'open'],
    ['accept', 'accepted'],
    ['accept_with_comment', 'accepted_with_comment'],
    ['disagree', 'disagreed'],
    ['request_clarification', 'clarification_requested'],
  ] as const;

  for (const review of REVIEW_STATES) {
    it.each(cases)(`${review}, latest response %s -> %s`, (kind, expected) => {
      expect(programSideState(review, kind)).toBe(expected);
    });
  }

  it('shows `open` for a clarification request the assessor already answered, and only then', () => {
    for (const review of REVIEW_STATES) {
      expect(programSideState(review, 'request_clarification', true)).toBe(
        'open',
      );
      expect(programSideState(review, 'request_clarification', false)).toBe(
        'clarification_requested',
      );
      // An answer only matters for a clarification request.
      expect(programSideState(review, 'disagree', true)).toBe('disagreed');
    }
  });

  it('leaves every other state as it is, whatever the response', () => {
    for (const state of commentStates) {
      if (REVIEW_STATES.includes(state)) continue;
      expect(programSideState(state, 'accept')).toBe(state);
    }
  });
});
