import { SpComment, SpResult, SpResults, SpTimelines } from '../../core/api/sp.models';
import { SP01 } from '../../core/sp/sp-testing';

/** Fake SP view data for specs (spec helper, not shipped: only imported by *.spec.ts). */
export function spComment(over: Partial<SpComment> = {}): SpComment {
  return {
    id: 501,
    fieldKey: 'title',
    body: 'The title does not say what changed.',
    state: 'open',
    createdAt: '2026-11-10T09:00:00.000Z',
    valueCopy: { value: 'Old title' },
    valueTruncated: false,
    response: null,
    history: [],
    clarifications: [],
    ...over,
  };
}

export function spResult(over: Partial<SpResult> = {}, comments: readonly SpComment[] = [spComment()]): SpResult {
  return {
    header: {
      resultCode: 123,
      title: 'Improved maize varieties',
      program: SP01,
      resultType: { key: 'KP', label: 'Knowledge product' },
      timeline: { id: 7, name: 'Official 2026' },
      status: 'returned_to_program',
      reportingUrl: 'https://reporting.example.org/result/123',
    },
    step: { position: 2, name: 'Programs review', opensAt: '2026-11-11T00:00', closesAt: '2026-11-30T17:30', state: 'in_progress' },
    sections: [
      {
        key: 'general',
        label: 'General information',
        fields: [
          {
            key: 'title',
            label: 'Title',
            type: 'text',
            mode: 'assessed',
            core: true,
            value: 'Improved maize varieties',
            labels: null,
            validated: false,
            comments,
            notApplicable: false,
          },
          {
            key: 'description',
            label: 'Description',
            type: 'text',
            mode: 'view',
            core: false,
            value: 'A description.',
            labels: null,
            validated: false,
            comments: [],
            notApplicable: false,
          },
        ],
      },
    ],
    other: [],
    writable: true,
    readOnlyReason: null,
    counts: { comments: comments.length, answered: 0 },
    ...over,
  };
}

export function spTimelines(over: Partial<SpTimelines> = {}): SpTimelines {
  return {
    timelines: [
      { id: 7, name: 'Official 2026', kind: 'official', step: { position: 2, name: 'Programs review', opensAt: '2026-11-11T00:00', closesAt: '2026-11-30T17:30', state: 'in_progress' } },
      { id: 8, name: 'Additional 2026', kind: 'additional', step: null },
    ],
    defaultTimelineId: 7,
    ...over,
  };
}

export function spResults(over: Partial<SpResults> = {}): SpResults {
  return {
    rows: [
      { resultCode: 123, title: 'Improved maize varieties', updated: true, resultType: { key: 'KP', label: 'Knowledge product' }, comments: 3, answered: 1, status: 'returned_to_program' },
      { resultCode: 124, title: 'Policy brief', updated: false, resultType: { key: 'PC', label: 'Policy change' }, comments: 0, answered: 0, status: 'quality_assessed' },
    ],
    options: {
      statuses: [
        { key: 'returned_to_program', label: 'Returned to program' },
        { key: 'quality_assessed', label: 'Quality Assessed' },
      ],
      resultTypes: [
        { key: 'KP', label: 'Knowledge product' },
        { key: 'PC', label: 'Policy change' },
      ],
    },
    step: spTimelines().timelines[0].step,
    ...over,
  };
}
