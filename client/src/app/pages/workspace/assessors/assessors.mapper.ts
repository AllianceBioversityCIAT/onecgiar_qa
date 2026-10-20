import { AllOr, ResultTypeOption, RoleGrant, ScienceProgramOption, UserSummary } from '../../../core/api/users.models';
import { BlockedProgram, InviteState, TeamActivity, TeamMember, TeamRole } from './assessors.models';

/** Catalogs the screen translates through: the API sends keys and CLARISA ids, the UI shows names and codes. */
export interface TeamCatalogs {
  readonly types: readonly ResultTypeOption[];
  readonly programs: readonly ScienceProgramOption[];
}

const DAY = 24 * 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "12 Feb 2026" (UTC, so the day does not move with the viewer's zone). */
export function dateLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Activity bucket from the last sign-in: never / within 3 days / older (labels in ACTIVITY_LABELS). */
export function activityOf(lastSignInAt: string | null, now: number): { act: TeamActivity; last: string; rank: number } {
  if (!lastSignInAt) return { act: 'never', last: 'Never signed in', rank: 1e9 };
  const at = new Date(lastSignInAt).getTime();
  const minutes = Math.max(0, Math.round((now - at) / 60000));
  const act: TeamActivity = now - at < 3 * DAY ? 'week' : 'stale';
  let last: string;
  if (minutes < 1) last = 'Just now';
  else if (minutes < 60) last = `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  else if (minutes < 24 * 60) last = `${Math.round(minutes / 60)} hour${Math.round(minutes / 60) === 1 ? '' : 's'} ago`;
  else if (minutes < 30 * 24 * 60) last = `${Math.round(minutes / 1440)} day${Math.round(minutes / 1440) === 1 ? '' : 's'} ago`;
  else last = `On ${dateLabel(lastSignInAt)}`;
  return { act, last, rank: minutes };
}

function nameOfType(key: string, cat: TeamCatalogs): string {
  return cat.types.find((t) => t.key === key)?.name ?? key;
}

/** A key the catalog no longer lists is shown as is (see nameOfType), so it maps back to itself. */
function keyOfType(name: string, cat: TeamCatalogs): string {
  return cat.types.find((t) => t.name === name)?.key ?? name;
}

function codeOfProgram(id: number, cat: TeamCatalogs): string {
  return cat.programs.find((p) => p.id === id)?.code ?? `#${id}`;
}

function idOfProgram(code: string, cat: TeamCatalogs): number | null {
  const known = cat.programs.find((p) => p.code === code)?.id;
  if (known !== undefined) return known;
  // A program CLARISA no longer lists is shown as "#<id>" (codeOfProgram): keep it, never drop it.
  const raw = /^#(\d+)$/.exec(code);
  return raw ? Number(raw[1]) : null;
}

function typesOf(grant: RoleGrant | undefined, cat: TeamCatalogs): string[] {
  if (!grant?.resultTypes) return [];
  return grant.resultTypes === 'all' ? cat.types.map((t) => t.name) : grant.resultTypes.map((k) => nameOfType(k, cat));
}

/**
 * The one role the screen shows (design D2), most powerful first. Assessor + Lead on different types
 * collapse into "Assessor, leads them all": `otherRoles` then flags that saving would change grants.
 */
function roleOf(grants: readonly RoleGrant[], cat: TeamCatalogs): { role: TeamRole; lead: boolean; types: string[]; noRole: boolean } {
  const byCode = (code: string) => grants.find((g) => g.role === code);
  if (byCode('ADMIN')) return { role: 'QA lead', lead: false, types: [], noRole: false };
  const lead = byCode('LEAD_ASSESSOR');
  if (lead?.resultTypes === 'all') return { role: 'Lead assessor', lead: true, types: [], noRole: false };
  const assessor = byCode('ASSESSOR');
  if (lead || assessor) {
    const types = [...new Set([...typesOf(lead, cat), ...typesOf(assessor, cat)])];
    return { role: 'Assessor', lead: !!lead, types, noRole: false };
  }
  if (byCode('TPB')) return { role: 'Third-party broker', lead: false, types: [], noRole: false };
  if (byCode('PPU')) return { role: 'PPU', lead: false, types: [], noRole: false };
  // No grant at all: the form needs a role to edit, but the screen says "No role" (nothing invented).
  return { role: 'Assessor', lead: false, types: [], noRole: true };
}

/** UI role → API grants. Never Assessor and Lead on the same type (the server answers 409). */
export function rolesFor(role: TeamRole, lead: boolean, typeNames: readonly string[], cat: TeamCatalogs): RoleGrant[] {
  switch (role) {
    case 'QA lead':
      return [{ role: 'ADMIN' }];
    case 'Third-party broker':
      return [{ role: 'TPB' }];
    case 'PPU':
      return [{ role: 'PPU' }];
    case 'Lead assessor':
      return [{ role: 'LEAD_ASSESSOR', resultTypes: 'all' }];
    case 'Assessor': {
      const keys = [...new Set(typeNames.map((n) => keyOfType(n, cat)))];
      if (!keys.length) return [];
      // Lead on every type stays a list: 'all' would turn this person into the "Lead assessor" role.
      const everyType = !lead && cat.types.length > 0 && cat.types.every((t) => keys.includes(t.key));
      const resultTypes: AllOr<string> = everyType ? 'all' : keys;
      return [{ role: lead ? 'LEAD_ASSESSOR' : 'ASSESSOR', resultTypes }];
    }
  }
}

/** UI program codes ([] = all) → API (`'all'` or CLARISA ids; `[]` is invalid for the server). */
export function programsFor(codes: readonly string[], cat: TeamCatalogs): AllOr<number> {
  const ids = codes.map((c) => idOfProgram(c, cat)).filter((id): id is number => id !== null);
  return ids.length ? ids : 'all';
}

export function programIdOf(code: string, cat: TeamCatalogs): number | null {
  return idOfProgram(code, cat);
}

export function sameGrants(a: readonly RoleGrant[], b: readonly RoleGrant[]): boolean {
  const norm = (list: readonly RoleGrant[]) =>
    JSON.stringify(
      [...list]
        .map((g) => ({ role: g.role, resultTypes: g.resultTypes === 'all' ? 'all' : [...(g.resultTypes ?? [])].sort() }))
        .sort((x, y) => x.role.localeCompare(y.role)),
    );
  return norm(a) === norm(b);
}

function inviteOf(u: UserSummary): InviteState {
  if (u.lastSignInAt) return null;
  if (u.invitation === 'sent') return 'pending';
  if (u.invitation === 'existing_account') return 'existing_account';
  return null;
}

export function toMember(u: UserSummary, cat: TeamCatalogs, now: number): TeamMember {
  const { role, lead, types, noRole } = roleOf(u.roles, cat);
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email;
  const blocked: BlockedProgram[] = u.exclusions.map((e) => ({
    code: codeOfProgram(e.programId, cat),
    reason: e.reason ?? '',
    date: dateLabel(e.since),
    id: e.id,
    origin: e.origin,
  }));
  return {
    id: String(u.id),
    nick: u.nickname ?? '',
    name,
    firstName: u.firstName ?? '',
    lastName: u.lastName ?? '',
    email: u.email,
    role,
    lead,
    types,
    prog: [],
    programs: u.programs === 'all' ? [] : u.programs.map((id) => codeOfProgram(id, cat)),
    blocked,
    ...activityOf(u.lastSignInAt, now),
    invite: inviteOf(u),
    canResend: u.status === 'active' && u.accountType === 'custom' && u.invitation === 'sent' && !u.lastSignInAt,
    active: u.status === 'active',
    otherRoles: !sameGrants(u.roles, rolesFor(role, lead, types, cat)),
    noRole,
    namesLocked: !!u.lastSignInAt,
  };
}

/** Account type rule (design integration review 5): CGIAR emails sign in with SSO, others get an invitation. */
export function accountTypeFor(email: string): 'sso' | 'custom' {
  return /@cgiar\.org$/i.test(email.trim()) ? 'sso' : 'custom';
}
