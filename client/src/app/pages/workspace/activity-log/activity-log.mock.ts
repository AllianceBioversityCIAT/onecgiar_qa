// Sample data for the configuration log (P2-3915, Traceability, AC 7–8). Design only.
// TODO(api): read the configuration log (timelines, field configuration, users) with who, when, before and after,
// filtered on the server by type, user and date.

export type LogType = 'timelines' | 'fields' | 'users';

export interface LogEntry {
  readonly id: string;
  readonly type: LogType;
  /** ISO date for `<time datetime>` and the date filter. */
  readonly at: string;
  /** "28 Jul 2026, 16:20". */
  readonly when: string;
  readonly by: { readonly name: string; readonly nickname: string };
  /** What changed: "Annual report 2026 · Assessors step". */
  readonly target: string;
  /** Which property: "End date". */
  readonly property: string;
  /** null when the thing did not exist before (created) or no longer exists (removed). */
  readonly before: string | null;
  readonly after: string | null;
}

export const LOG_TYPES: readonly { readonly value: LogType; readonly label: string }[] = [
  { value: 'timelines', label: 'Timelines' },
  { value: 'fields', label: 'Field configuration' },
  { value: 'users', label: 'Users' },
];

/** The sample's "today", so the date filter gives the same answer every day. */
export const LOG_TODAY = '2026-07-30';

const SOFIA = { name: 'Sofía Méndez', nickname: 'smendez' };
const TOMAS = { name: 'Tomás Rivera', nickname: 'trivera' };

/** Older, repetitive set-up changes (01–27 Jun 2026), so the sample fills more than one page. */
const SETUP: readonly Omit<LogEntry, 'id' | 'at' | 'when'>[] = [
  { type: 'fields', by: TOMAS, target: 'Capacity sharing · Number of people trained', property: 'In QA', before: 'View only', after: 'Assessed' },
  { type: 'users', by: SOFIA, target: 'Assessor invited for SP04', property: 'Platform access', before: null, after: 'Invited as assessor' },
  { type: 'timelines', by: SOFIA, target: 'Annual report 2026 · Programs correct step', property: 'End date', before: '22 Jul 2026', after: '23 Jul 2026' },
  { type: 'fields', by: TOMAS, target: 'Policy change · Stage of the policy', property: 'Core field', before: 'No', after: 'Yes' },
  { type: 'users', by: TOMAS, target: 'Assessor in Annual report 2026', property: 'Result types', before: 'Policy change', after: 'Policy change, Innovation use' },
];

const PAST: readonly LogEntry[] = Array.from({ length: 27 }, (_, i) => {
  const day = String(27 - i).padStart(2, '0');
  const minute = String((i * 7) % 60).padStart(2, '0');
  return { ...SETUP[i % SETUP.length], id: `p${i + 1}`, at: `2026-06-${day}T10:${minute}`, when: `${day} Jun 2026, 10:${minute}` };
});

/** Newest first. */
export const ACTIVITY_LOG: readonly LogEntry[] = [
  { id: 'l1', type: 'users', at: '2026-07-30T09:12', when: '30 Jul 2026, 09:12', by: SOFIA, target: 'Daniel Okoro (dokoro)', property: 'Role in SP03 late reporting', before: null, after: 'Third-party broker' },
  { id: 'l2', type: 'timelines', at: '2026-07-29T17:40', when: '29 Jul 2026, 17:40', by: SOFIA, target: 'SP03 late reporting · Assessors step', property: 'End date', before: '02 Aug 2026', after: '05 Aug 2026' },
  { id: 'l3', type: 'fields', at: '2026-07-29T11:05', when: '29 Jul 2026, 11:05', by: TOMAS, target: 'Innovation development · Innovation readiness level', property: 'Core field', before: 'No', after: 'Yes' },
  { id: 'l4', type: 'users', at: '2026-07-28T16:20', when: '28 Jul 2026, 16:20', by: SOFIA, target: 'R. Silva (rsilva)', property: 'Assessor in July 2026 sub-timeline', before: 'Assigned', after: null },
  { id: 'l5', type: 'timelines', at: '2026-07-28T10:02', when: '28 Jul 2026, 10:02', by: SOFIA, target: 'September pilot', property: 'Timeline', before: null, after: 'Created · SP09 · starts 01 Sep 2026' },
  { id: 'l6', type: 'fields', at: '2026-07-26T15:30', when: '26 Jul 2026, 15:30', by: TOMAS, target: 'Policy change · Evidence', property: 'In QA', before: 'View only', after: 'Assessed' },
  { id: 'l7', type: 'users', at: '2026-07-25T09:45', when: '25 Jul 2026, 09:45', by: TOMAS, target: 'Lucía Pérez (lperez)', property: 'Platform role', before: 'Assessor', after: 'Lead assessor' },
  { id: 'l8', type: 'timelines', at: '2026-07-24T08:10', when: '24 Jul 2026, 08:10', by: SOFIA, target: 'Annual report 2026 · Lead assessor step', property: 'Start date', before: '25 Jul 2026', after: '24 Jul 2026' },
  { id: 'l9', type: 'timelines', at: '2026-07-21T14:00', when: '21 Jul 2026, 14:00', by: SOFIA, target: 'July 2026 sub-timeline', property: 'Science programs', before: 'SP02', after: 'SP02, SP05' },
  { id: 'l10', type: 'fields', at: '2026-07-18T10:20', when: '18 Jul 2026, 10:20', by: TOMAS, target: 'Knowledge product · Title', property: 'In QA', before: 'Assessed', after: 'Hidden' },
  { id: 'l11', type: 'users', at: '2026-07-15T12:30', when: '15 Jul 2026, 12:30', by: SOFIA, target: 'Grace Wanjiru (gwanjiru)', property: 'Platform access', before: null, after: 'Invited as PPU' },
  { id: 'l12', type: 'timelines', at: '2026-07-10T09:00', when: '10 Jul 2026, 09:00', by: SOFIA, target: 'Knowledge products fast track', property: 'Steps', before: 'Assessors · Programs correct · Lead assessor · Third-party broker · PPU', after: 'Assessors · Programs correct · PPU' },
  { id: 'l13', type: 'users', at: '2026-07-03T16:45', when: '03 Jul 2026, 16:45', by: TOMAS, target: 'Ana Ruiz (aruiz)', property: 'Platform access', before: 'Active', after: 'Removed' },
  { id: 'l14', type: 'fields', at: '2026-06-28T11:10', when: '28 Jun 2026, 11:10', by: TOMAS, target: 'Innovation use · Geographic focus', property: 'Assessor guidance', before: 'Check the countries.', after: 'Check that every country has evidence of use.' },
  ...PAST,
];
