// UI model of the Assessors view. Built from the user-management API by `assessors.mapper.ts`.

export type TeamRole = 'Assessor' | 'Lead assessor' | 'Third-party broker' | 'PPU' | 'QA lead';
export type TeamActivity = 'week' | 'stale' | 'never';

export interface BlockedProgram {
  /** Program code (e.g. "SP05"). */
  readonly code: string;
  readonly reason: string;
  /** Display date, e.g. "12 Feb 2026". */
  readonly date: string;
  /** API exclusion id (needed to remove it). */
  readonly id?: number;
  /** `reporting` blocks come from the Reporting Tool: they are dismissed with a reason, not removed. */
  readonly origin?: 'manual' | 'reporting';
}

/** Review progress for one result type. Empty until the results module exists (no API yet). */
export interface TypeProgress {
  readonly label: string;
  readonly reviewed: number;
  readonly assigned: number;
}

/** What the invitation badge and the "Resend invitation" action show. */
export type InviteState = 'pending' | 'existing_account' | null;

export interface TeamMember {
  readonly id: string;
  readonly nick: string;
  /** First and last name joined (the API keeps them apart). */
  readonly name: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly role: TeamRole;
  /** Result type names this person assesses (only meaningful for the Assessor role). */
  readonly types: readonly string[];
  readonly prog: readonly TypeProgress[];
  /** Science program codes they are limited to; empty = all programs. */
  readonly programs: readonly string[];
  /** Leads the assessment of their result types (LEAD_ASSESSOR grant). */
  readonly lead: boolean;
  readonly blocked: readonly BlockedProgram[];
  readonly act: TeamActivity;
  /** "1 hour ago", "Never signed in"… */
  readonly last: string;
  /** Minutes since last sign-in, used to sort. */
  readonly rank: number;
  readonly invite: InviteState;
  /** Resend is allowed (active custom account, invitation sent, never signed in). */
  readonly canResend: boolean;
  readonly active: boolean;
  /** The API holds grants this one-role screen cannot show exactly: saving roles replaces them. */
  readonly otherRoles: boolean;
  /** Names can change only until the first sign-in. */
  readonly namesLocked: boolean;
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

export const ACTIVITY_LABELS: Readonly<Record<TeamActivity, string>> = {
  week: 'Active this week',
  stale: 'Inactive 3+ days',
  never: 'Never signed in',
};

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
