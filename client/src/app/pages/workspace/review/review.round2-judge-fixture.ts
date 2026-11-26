// @akili-spec escalation/round-2
// Test fixture: round-2 views as `GET …/assessment` answers a TPB (step 4, P2-3916 front contract § 4) and a PPU
// (step 5, P2-3917 front contract § 4), and the answers of their decisions (§ 5). Used by specs only.
import { AssessmentView, DecisionResult, ThreadItem } from '../../../core/api/assessment.models';
import { field } from './review.api-fixture';
import { roundTwoViewFixture, threadItem } from './review.round2-fixture';

const LEAD_ESCALATE = { decision: 'escalate' as const, body: 'TPB should check the evidence.', decidedAt: '2026-11-25T11:00:00.000Z' };

/** An assessor's round-1 comment the Lead escalated: the TPB sides with the program or with the assessor. */
export const tpbItem = (over: Partial<ThreadItem> = {}): ThreadItem =>
  threadItem({
    state: 'escalated',
    round: 1,
    leadDecision: LEAD_ESCALATE,
    choices: ['tpb_agree_program', 'tpb_agree_assessor'],
    ...over,
  });

/** The Lead's own round-2 comment it escalated (no program response). */
export const tpbLeadOwnItem = (over: Partial<ThreadItem> = {}): ThreadItem =>
  tpbItem({
    commentId: 8101,
    author: { id: 14, nickname: 'lea' },
    body: 'The core field is still wrong.',
    valueCopy: { value: 'New description' },
    round: 2,
    response: undefined,
    leadDecision: { decision: 'escalate', body: 'Escalating my own finding.', decidedAt: '2026-11-25T11:05:00.000Z' },
    ...over,
  });

/** A case for the PPU: the TPB sided with the assessor. */
export const ppuItem = (over: Partial<ThreadItem> = {}): ThreadItem =>
  threadItem({
    state: 'tpb_sided_assessor',
    round: 1,
    leadDecision: LEAD_ESCALATE,
    tpbDecision: { decision: 'tpb_agree_assessor', body: 'The assessor is right.', decidedAt: '2026-11-30T10:00:00.000Z' },
    choices: ['ppu_done'],
    ...over,
  });

const titleField = () =>
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
  });

const regionsField = () =>
  field({
    key: 'geo.regions',
    label: 'Regions',
    type: 'multi_select',
    core: false,
    value: [1, 2],
    actionable: false,
    effectiveValidated: false,
    carried: false,
    thread: [],
  });

/** Step 4, the TPB writes: one core field carried green, one with two escalated items (round 1 and the Lead's own). */
export function tpbViewFixture(thread: readonly ThreadItem[] = [tpbItem(), tpbLeadOwnItem()], over: Partial<AssessmentView> = {}): AssessmentView {
  const base = roundTwoViewFixture();
  return {
    ...base,
    header: { ...base.header, step: { position: 4, name: 'TPB' }, status: 'pending_tpb_review' },
    assessment: null,
    sections: [
      {
        key: 'general_information',
        label: 'General information',
        fields: [
          titleField(),
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
            thread,
            comments: [],
          }),
          regionsField(),
        ],
      },
    ],
    ...over,
  };
}

/** Step 5, the PPU writes: one case on the description, its Reporting value changed since the TPB judged it. */
export function ppuViewFixture(thread: readonly ThreadItem[] = [ppuItem()], over: Partial<AssessmentView> = {}): AssessmentView {
  const base = roundTwoViewFixture();
  return {
    ...base,
    header: { ...base.header, step: { position: 5, name: 'PPU' }, status: 'pending_ppu' },
    assessment: null,
    sections: [
      {
        key: 'general_information',
        label: 'General information',
        fields: [
          titleField(),
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
            thread,
            comments: [],
            changedInReporting: { detectedAt: '2026-12-03T09:00:00.000Z' },
          }),
          regionsField(),
        ],
      },
    ],
    ...over,
  };
}

/** What a PPU read answers once the last case is Done: Quality Assessed, read only. */
export const closedPpuView = (): AssessmentView =>
  ppuViewFixture(
    [ppuItem({ decidable: false, choices: [], decision: { decision: 'ppu_done', body: null, decidedAt: '2026-12-04T10:00:00.000Z' } })],
    {
      writable: false,
      readOnlyReason: 'finished',
      header: { ...ppuViewFixture().header, status: 'quality_assessed' },
      assessment: { status: 'quality_assessed', assessedBy: { id: 90, nickname: 'pat' }, finishedAt: '2026-12-04T10:00:00.000Z' },
    },
  );

/** The answer of a TPB decision or a PPU Done (`status` pending unless the call closed the result). */
export const judgeDecisionResult = (over: Partial<DecisionResult> = {}): DecisionResult => ({
  status: 'pending',
  assessedBy: null,
  finishedAt: null,
  validations: [],
  decision: { decision: 'tpb_agree_program', body: 'The program is right.', decidedAt: '2026-11-30T10:00:00.000Z' },
  ...over,
});
