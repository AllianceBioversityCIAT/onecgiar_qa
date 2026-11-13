import { ASSIGNABLE_ROLES, AssignableRole, TimelineUser } from '../../../core/api/cycles.models';
import { UserSummary } from '../../../core/api/users.models';

/** One block of the People drawer: a role that can be assigned to a timeline, in workflow order. */
export interface RoleSection {
  readonly role: AssignableRole;
  readonly title: string;
  /** What these people do in the timeline, in one line. */
  readonly hint: string;
}

/** Timeline roles in the order they work (front contract § 4: only these four can be assigned). */
export const ROLE_SECTIONS: readonly RoleSection[] = [
  { role: 'ASSESSOR', title: 'Assessors', hint: 'Approve or comment each field (step 1).' },
  { role: 'LEAD_ASSESSOR', title: 'Lead assessors', hint: 'Send disputed core comments to the broker (step 3).' },
  { role: 'TPB', title: 'Third-party brokers', hint: 'Decide each comment sent to them (step 4).' },
  { role: 'PPU', title: 'PPU', hint: 'Apply the broker’s decisions and mark them done (step 5).' },
];

/** First and last name, or the email when the account has no name yet (SSO users can come without one). */
export function personName(p: Pick<UserSummary, 'firstName' | 'lastName' | 'email'>): string {
  const name = [p.firstName, p.lastName].filter((x) => !!x && x.trim()).join(' ').trim();
  return name || p.email;
}

/** The people assigned to the timeline, grouped per role and sorted by name. */
export function assignedByRole(users: readonly TimelineUser[]): Readonly<Record<AssignableRole, readonly TimelineUser[]>> {
  const byName = (a: TimelineUser, b: TimelineUser) => personName(a).localeCompare(personName(b));
  const out = Object.fromEntries(ASSIGNABLE_ROLES.map((r) => [r, [] as TimelineUser[]])) as Record<AssignableRole, TimelineUser[]>;
  for (const u of users) out[u.role]?.push(u);
  for (const r of ASSIGNABLE_ROLES) out[r].sort(byName);
  return out;
}

/**
 * Who can be added to a role: active people holding a live grant of that role (else the server answers
 * 409 TIMELINES_USER_NOT_ELIGIBLE), minus the ones already holding it in this timeline. Sorted by name.
 */
export function candidatesFor(role: AssignableRole, team: readonly UserSummary[], assigned: readonly TimelineUser[]): readonly UserSummary[] {
  const taken = new Set(assigned.filter((a) => a.role === role).map((a) => a.userId));
  return team
    .filter((u) => u.status === 'active' && !taken.has(u.id) && u.roles.some((g) => g.role === role))
    .sort((a, b) => personName(a).localeCompare(personName(b)));
}

/** "3 assessors · 1 lead assessor · 0 third-party brokers · 1 PPU": the drawer subtitle. */
export function peopleSummary(users: readonly TimelineUser[]): string {
  const n = (role: AssignableRole) => users.filter((u) => u.role === role).length;
  const word = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  return [
    word(n('ASSESSOR'), 'assessor', 'assessors'),
    word(n('LEAD_ASSESSOR'), 'lead assessor', 'lead assessors'),
    word(n('TPB'), 'third-party broker', 'third-party brokers'),
    `${n('PPU')} PPU`,
  ].join(' · ');
}
