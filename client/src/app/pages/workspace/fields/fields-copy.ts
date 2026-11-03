// Fixed copy of the Fields view: the three states and the column help.
import type { FieldState } from './fields-config';

export interface FieldStateOption {
  readonly value: FieldState;
  readonly label: string;
}

export interface FieldHeadHelp {
  readonly label: string;
  readonly align: 'start' | 'center';
  readonly text?: string;
  readonly items?: readonly { readonly label: string; readonly text: string }[];
  readonly note?: string;
}

export const FIELD_STATES: readonly FieldStateOption[] = [
  { value: 'hidden', label: 'Hidden' },
  { value: 'view_only', label: 'View only' },
  { value: 'assessed', label: 'Assessed' },
];

export const FIELD_HEAD_HELP: readonly FieldHeadHelp[] = [
  {
    label: 'In QA',
    align: 'start',
    items: [
      { label: 'Hidden', text: 'The assessor does not see the field.' },
      { label: 'View only', text: 'The assessor sees it as context. No comments, no AI, not core.' },
      { label: 'Assessed', text: 'The assessor approves it or leaves a comment.' },
    ],
    note: 'Assessors can comment on any field that is assessed. They never comment on a view only field.',
  },
  {
    label: 'Core',
    align: 'center',
    text: 'Comments on core fields go up for a second review: first to the TPB, then to the PPU.',
  },
  {
    label: 'AI',
    align: 'center',
    text: 'The AI helper drafts an assessment of this field for the assessor to confirm or override. It never approves a field on its own.',
  },
];

export const REQUIRED_HIDDEN_HELP =
  'This field is required in the reporting tool but not assessed in QA, so no assessor will check it.';

export const CONDITIONAL_HELP = 'Required in the reporting tool only in some cases.';
