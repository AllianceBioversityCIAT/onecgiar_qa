// @akili-spec escalation/round-2
// Test fixture: a round-2 (Lead Assessor) assessment view as `GET …/assessment` answers it (round-2 front contract
// § 3, § 3.1, § 3.2) and the answer of a decision (§ 4.1). Used by specs only. Built on the step-1 fixture helpers.
import { AssessmentView, DecisionResult, ThreadItem } from '../../../core/api/assessment.models';
import { comment, field, viewFixture } from './review.api-fixture';

/** A round-1 comment the program disagreed with: the Lead may agree with the program or escalate it. */
export const threadItem = (over: Partial<ThreadItem> = {}): ThreadItem => ({
  commentId: 41,
  author: { id: 1053, nickname: 'mchen' },
  createdAt: '2026-11-12T10:15:00.000Z',
  body: 'The description does not match the evidence.',
  valueCopy: { value: 'Old description' },
  valueTruncated: false,
  state: 'disagreed',
  response: {
    id: 70,
    kind: 'disagree',
    body: 'The evidence was updated in this submission.',
    respondedBy: { name: 'Pepa Program' },
    respondedAt: '2026-11-18T14:00:00.000Z',
  },
  clarifications: [],
  decidable: true,
  choices: ['agree_program', 'escalate'],
  ...over,
});

/**
 * Round 2 for the Lead: one core field carried green from round 1 (no comment, unchanged), one core field updated
 * since round 1 with a decidable thread item and an own round-2 comment of the Lead not decided yet (§ 3.2), and
 * one Assessed field that is not core (context only).
 */
export function roundTwoViewFixture(over: Partial<AssessmentView> = {}): AssessmentView {
  const base = viewFixture();
  return {
    ...base,
    round: 2,
    header: { ...base.header, step: { position: 3, name: 'Lead assessors' } },
    sections: [
      {
        key: 'general_information',
        label: 'General information',
        fields: [
          field({
            key: 'general.title',
            label: 'Title of Result',
            core: true,
            value: 'Seed systems for maize',
            validated: false,
            updated: false,
            actionable: true,
            effectiveValidated: true,
            carried: true,
            thread: [],
          }),
          field({
            key: 'general.description',
            label: 'Description of Result',
            core: true,
            value: 'New description',
            validated: false,
            updated: true,
            actionable: true,
            effectiveValidated: false,
            carried: false,
            thread: [threadItem()],
            comments: [
              comment({
                id: 8101,
                fieldKey: 'general.description',
                author: { id: 14, nickname: 'lea' },
                body: 'The core field is still wrong.',
                stepPosition: 3,
                round: 2,
                valueCopy: { value: 'New description' },
                createdAt: '2026-11-25T10:00:00.000Z',
                // Not escalated yet: an escalate here would take `agree_program` out of the thread item's choices.
                decision: null,
                decidable: true,
                choices: ['escalate'],
              }),
            ],
          }),
          field({
            key: 'geo.regions',
            label: 'Regions',
            type: 'multi_select',
            core: false,
            value: [1, 2],
            updated: false,
            actionable: false,
            effectiveValidated: false,
            carried: false,
            thread: [],
          }),
        ],
      },
    ],
    other: [],
    ...over,
  };
}

/** The answer of `PUT …/decisions/41` with `agree_program` that left a core field grey: the review goes on. */
export const decisionResultFixture = (over: Partial<DecisionResult> = {}): DecisionResult => ({
  status: 'pending',
  assessedBy: null,
  finishedAt: null,
  validations: [{ fieldKey: 'general.description', validated: true }],
  decision: { decision: 'agree_program', body: 'The program is right.', decidedAt: '2026-11-25T11:00:00.000Z' },
  ...over,
});
