// Mock data for the Assessors view, copied from the "QA Platform" mockup (TEAM, ROLE_OPTS, TYPES,
// PROGRAMS, PROG_N, ACTIVITY, GAP_DEMO). A dev will replace this file with the team API.
// Note: TYPE_COUNTS / PROGRAMS also exist as local copies in other workspace views.

export type TeamRole = 'Assessor' | 'Lead assessor' | 'Third-party broker' | 'PPU' | 'QA lead';
export type TeamActivity = 'week' | 'stale' | 'never';

export interface BlockedProgram {
  readonly code: string;
  readonly reason: string;
  /** Display date, e.g. "12 Feb 2026". */
  readonly date: string;
}

/** Progress for one result type: [label, reviewed, assigned]. "All types" for non-assessor roles. */
export interface TypeProgress {
  readonly label: string;
  readonly reviewed: number;
  readonly assigned: number;
}

export interface TeamMember {
  readonly id: string;
  readonly nick: string;
  readonly name: string;
  readonly email: string;
  readonly role: TeamRole;
  /** Result types this person assesses (only meaningful for the Assessor role). */
  readonly types: readonly string[];
  readonly prog: readonly TypeProgress[];
  /** Science programs they are limited to; empty = all programs. */
  readonly programs: readonly string[];
  /** Can edit and delete other assessors' comments. */
  readonly lead: boolean;
  readonly blocked: readonly BlockedProgram[];
  readonly act: TeamActivity;
  /** "1 hour ago", "Never signed in"… */
  readonly last: string;
  /** Minutes since last activity, used to sort by "Last active". */
  readonly rank: number;
}

export interface RoleOption {
  readonly role: TeamRole;
  readonly description: string;
}

export const ROLE_OPTIONS: readonly RoleOption[] = [
  { role: 'Assessor', description: 'Approves and comments on fields' },
  { role: 'Lead assessor', description: 'Highlights core fields for correction' },
  { role: 'Third-party broker', description: 'Corrects highlighted fields' },
  { role: 'PPU', description: 'Closes results at the end of the cycle' },
  { role: 'QA lead', description: 'Administers the platform' },
];

/** Results in QA per result type (mockup TYPES without "All"). */
export const TYPE_COUNTS: Readonly<Record<string, number>> = {
  'Knowledge product': 342,
  'Innovation development': 261,
  'Capacity sharing for development': 198,
  'Other output': 74,
  'Innovation use': 112,
  'Policy change': 89,
  'Other outcome': 38,
};
export const TYPE_NAMES: readonly string[] = Object.keys(TYPE_COUNTS);

export const PROGRAMS: Readonly<Record<string, string>> = {
  SP01: 'Breeding for Tomorrow',
  SP02: 'Rice Agrifood Systems',
  SP04: 'Climate Action',
  SP05: 'Multifunctional Landscapes',
  SP07: 'Genetic Innovation',
  SP09: 'Sustainable Animal and Aquatic Foods',
  SP11: 'Policy Innovations',
  SP12: 'Scaling for Impact',
};
export const PROGRAM_CODES: readonly string[] = Object.keys(PROGRAMS);

/** Results in QA per science program (shown as counts in the programs picker). */
export const PROGRAM_COUNTS: Readonly<Record<string, number>> = {
  SP01: 96,
  SP02: 214,
  SP04: 131,
  SP05: 158,
  SP07: 122,
  SP09: 187,
  SP11: 118,
  SP12: 88,
};

export const ACTIVITY_LABELS: Readonly<Record<TeamActivity, string>> = {
  week: 'Active this week',
  stale: 'Inactive 3+ days',
  never: 'Never signed in',
};

/** Result types the demo flags as gaps while their assessors stay as in the seed data. */
export const GAP_DEMO: readonly string[] = ['Innovation development', 'Other outcome'];

/** Sub-timeline where current assignments live (copy in the drawer notice). */
export const CURRENT_SUBTIMELINE = 'July 2026 sub-timeline';

/** Mockup "today" (19 Jul 2026), used as the date of a new conflict-of-interest block. */
export const TODAY_LABEL = '19 Jul 2026';

function member(
  nick: string,
  name: string,
  role: TeamRole,
  types: readonly string[],
  prog: readonly (readonly [string, number, number])[],
  programs: readonly string[],
  lead: boolean,
  act: TeamActivity,
  last: string,
  rank: number,
  blocked: readonly BlockedProgram[] = [],
): TeamMember {
  return {
    id: name,
    nick,
    name,
    email: name.toLowerCase().replace('. ', '.') + '@cgiar.org',
    role,
    types,
    prog: prog.map(([label, reviewed, assigned]) => ({ label, reviewed, assigned })),
    programs,
    lead,
    blocked,
    act,
    last,
    rank,
  };
}

export const TEAM: readonly TeamMember[] = [
  member('Assessor SR', 'S. Restrepo', 'Assessor', ['Knowledge product'], [['Knowledge product', 74, 90]], [], true, 'week', '1 hour ago', 60),
  member('Assessor NH', 'N. Haddad', 'Assessor', ['Capacity sharing for development'], [['Capacity sharing for development', 46, 47]], ['SP01', 'SP04'], false, 'week', '25 minutes ago', 25),
  member('Assessor TA', 'T. Abebe', 'Assessor', ['Other output'], [['Other output', 30, 33]], [], false, 'week', '3 hours ago', 180),
  member('Assessor MC', 'M. Chen', 'Assessor', ['Innovation use', 'Innovation development'], [['Innovation development', 4, 31], ['Innovation use', 34, 55]], ['SP02', 'SP07', 'SP09'], false, 'week', '2 hours ago', 120),
  member('Assessor AF', 'A. Farooq', 'Assessor', ['Policy change'], [['Policy change', 24, 42]], ['SP11'], false, 'week', '6 hours ago', 360, [
    { code: 'SP05', reason: 'Co-authored two results in this program', date: '12 Feb 2026' },
    { code: 'SP09', reason: 'Former staff member', date: '12 Feb 2026' },
  ]),
  member('Assessor RS', 'R. Silva', 'Assessor', ['Capacity sharing for development'], [['Capacity sharing for development', 29, 71]], [], false, 'stale', '3 days ago', 4320),
  member('Assessor DD', 'D. Okeke', 'Assessor', ['Knowledge product'], [['Knowledge product', 21, 88]], ['SP02', 'SP05', 'SP11'], false, 'stale', '4 days ago', 5760),
  member('Assessor LM', 'L. Mwangi', 'Assessor', ['Innovation development'], [['Innovation development', 0, 64]], [], false, 'never', 'Never signed in', 1e9),
  member('Lead HB', 'H. Bertrand', 'Lead assessor', [], [['All types', 84, 96]], [], true, 'week', '5 hours ago', 300),
  member('Broker PN', 'P. Nakamura', 'Third-party broker', [], [['All types', 12, 12]], [], false, 'week', '2 days ago', 2880),
  member('PPU GO', 'G. Obeng', 'PPU', [], [['All types', 134, 216]], [], false, 'week', '40 minutes ago', 40),
];

/** Sorted names of the assessors of a type; used to tell whether the demo gap was touched. */
export function coverageKey(team: readonly TeamMember[], type: string): string {
  return team
    .filter((p) => p.role === 'Assessor' && p.types.includes(type))
    .map((p) => p.name)
    .sort()
    .join('|');
}

export const COVERAGE_INIT: Readonly<Record<string, string>> = Object.fromEntries(
  TYPE_NAMES.map((t) => [t, coverageKey(TEAM, t)]),
);

/** "S. Restrepo" -> "SR". */
export function initials(name: string): string {
  return name
    .replace(/\./g, '')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function fmt(n: number): string {
  return n.toLocaleString('en-US');
}
