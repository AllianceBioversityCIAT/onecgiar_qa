// @akili-spec assessment/step-1-assessment
// Test fixture: an assessment view exactly as `GET …/assessment` answers it (front-contract § 5.1). Used by the
// review specs only; every view model under test is built from it through `review.mapper.ts`.
import { AssessmentComment, AssessmentField, AssessmentView, CommentThread, ProgramResponse } from '../../../core/api/assessment.models';

export const comment = (over: Partial<AssessmentComment> = {}): AssessmentComment => ({
  id: 1,
  fieldKey: 'general.description',
  author: { id: 1053, nickname: 'mchen' },
  body: 'Add the evidence link.',
  state: 'open',
  stepPosition: 1,
  round: 1,
  valueCopy: { value: 'Old' },
  valueTruncated: false,
  createdAt: '2026-11-12T10:15:00.000Z',
  withdrawnAt: null,
  ...over,
});

/** A response of the program to a comment, as `GET …/sp-responses` answers it (P2-3911). */
export const programResponse = (over: Partial<ProgramResponse> = {}): ProgramResponse => ({
  id: 70,
  kind: 'request_clarification',
  body: 'Which evidence link do you mean?',
  respondedBy: { name: 'Pepa Program', email: 'pepa@program.org' },
  respondedAt: '2026-11-18T14:00:00.000Z',
  ...over,
});

/** The thread of comment 1 with one clarification the program requested and nobody answered yet. */
export const clarificationThread = (over: Partial<CommentThread> = {}): CommentThread => {
  const request = programResponse();
  return {
    commentId: 1,
    fieldKey: 'general.description',
    state: 'clarification_requested',
    response: request,
    history: [request],
    clarifications: [{ requestId: request.id, question: request.body ?? '', requestedAt: request.respondedAt, answer: null }],
    ...over,
  };
};

export const field = (over: Partial<AssessmentField> & Pick<AssessmentField, 'key' | 'label'>): AssessmentField => ({
  type: 'text',
  mode: 'assessed',
  core: false,
  value: 'Some value',
  labels: null,
  validated: false,
  comments: [],
  notApplicable: false,
  ...over,
});

/** General information (assessed core green, assessed grey with one open and one withdrawn comment, view only),
 * the Theory of Change group, a section with labels and a not-applicable field, and one "other" key. */
export function viewFixture(over: Partial<AssessmentView> = {}): AssessmentView {
  return {
    header: {
      resultCode: 9890,
      title: 'Seed systems for maize',
      program: { id: 51, code: 'SP05', name: 'Better Diets and Nutrition' },
      resultType: { key: 'policy_change', label: 'Policy change' },
      timeline: { id: 29, name: 'Official timeline 2026' },
      step: { position: 1, name: 'Assessment' },
      status: 'pending',
    },
    sections: [
      {
        key: 'general_information',
        label: 'General information',
        fields: [
          field({ key: 'general.title', label: 'Title of Result', core: true, validated: true, value: 'Seed systems for maize' }),
          field({
            key: 'general.description',
            label: 'Description of Result',
            value: 'A long description',
            comments: [comment(), comment({ id: 2, state: 'withdrawn', body: 'Old remark', withdrawnAt: '2026-11-12T11:00:00.000Z' })],
          }),
          field({ key: 'general.result_code', label: 'Result code', type: 'number', mode: 'view', value: 9890 }),
        ],
      },
      {
        key: 'theory_of_change',
        label: 'Theory of Change',
        fields: [
          field({ key: 'toc.planned_result', label: 'Can this result be mapped to a ToC KPI?', type: 'boolean', mode: 'view', value: true }),
          field({
            key: 'toc.entries',
            label: 'ToC contributions',
            type: 'list',
            core: true,
            value: [
              { level: 2, toc_result: 801, kpi: 9001, target: 10, contribution_to_target: 4 },
              { level: 3, toc_result: 802, hlo_statement: 'More seed sold', kpi: 9002, target: 5, contribution_to_target: 1 },
            ],
            labels: { toc_levels: { '2': 'Outcome', '3': 'Output' }, toc_results: { '801': 'Seed policy adopted', '802': null } },
          }),
          field({
            key: 'contributors.science_programs',
            label: 'Contributing Science Program/Accelerator',
            type: 'list',
            mode: 'view',
            value: [{ program: 52, from_toc: true, planned_result: true, toc_entries: [{ level: 2, toc_result: 803, target: 3, contribution_to_target: 2 }] }],
            labels: { initiatives: { '52': 'SP06 Climate Action' } },
          }),
        ],
      },
      {
        key: 'geographic_location',
        label: 'Geographic location',
        fields: [
          field({
            key: 'geo.countries',
            label: 'Countries',
            type: 'multi_select',
            value: [170, 999],
            labels: { countries: { '170': 'Colombia', '999': null } },
          }),
          field({ key: 'geo.regions', label: 'Regions', type: 'multi_select', value: [1, 2] }),
          field({ key: 'geo.scope', label: 'Geographic scope', type: 'single_select', mode: 'view', value: null, notApplicable: true }),
        ],
      },
    ],
    other: [field({ key: 'legacy.key', label: 'legacy.key', type: 'unknown', mode: 'view', value: 'kept' })],
    writable: true,
    readOnlyReason: null,
    assessment: null,
    ...over,
  };
}
