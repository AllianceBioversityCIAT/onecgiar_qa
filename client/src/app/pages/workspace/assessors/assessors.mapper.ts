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
 * The role the screen shows, most powerful first, plus the result types of each type role
 * (P2-4107): any ASSESSOR grant = "Assessor"; only LEAD_ASSESSOR = "Lead assessor". The two never
 * share a type (server rule D2), so both lists are shown and edited exactly.
 */
function roleOf(
  grants: readonly RoleGrant[],
  cat: TeamCatalogs,
): { role: TeamRole; lead: boolean; assessTypes: string[]; leadTypes: string[]; noRole: boolean } {
  const byCode = (code: string) => grants.find((g) => g.role === code);
  const none = { lead: false, assessTypes: [], leadTypes: [], noRole: false };
  if (byCode('ADMIN')) return { ...none, role: 'QA lead' };
  const lead = byCode('LEAD_ASSESSOR');
  const assessor = byCode('ASSESSOR');
  if (lead || assessor) {
    return {
      role: assessor ? 'Assessor' : 'Lead assessor',
      lead: !!lead,
      assessTypes: typesOf(assessor, cat),
      leadTypes: typesOf(lead, cat),
      noRole: false,
    };
  }
  if (byCode('TPB')) return { ...none, role: 'Third-party broker' };
  if (byCode('PPU')) return { ...none, role: 'PPU' };
  // No grant at all: the form needs a role to edit, but the screen says "No role" (nothing invented).
  return { ...none, role: 'Assessor', noRole: true };
}

/** Catalog keys of the names; every catalog type = `'all'` (also covers types added later). */
function scopeOf(names: readonly string[], cat: TeamCatalogs): AllOr<string> {
  const keys = [...new Set(names.map((n) => keyOfType(n, cat)))];
  const everyType = cat.types.length > 0 && cat.types.every((t) => keys.includes(t.key));
  return everyType ? 'all' : keys;
}

/**
 * UI role → API grants. Assessor and Lead assessor send one grant per role that has types, each
 * with its own types (P2-4107). Never the same type in both (the server answers 409): a type in
 * both lists stays on the lead side; the store refuses that case before getting here.
 */
export function rolesFor(role: TeamRole, assessTypes: readonly string[], leadTypes: readonly string[], cat: TeamCatalogs): RoleGrant[] {
  switch (role) {
    case 'QA lead':
      return [{ role: 'ADMIN' }];
    case 'Third-party broker':
      return [{ role: 'TPB' }];
    case 'PPU':
      return [{ role: 'PPU' }];
    case 'Assessor':
    case 'Lead assessor': {
      const assess = assessTypes.filter((t) => !leadTypes.includes(t));
      const grants: RoleGrant[] = [];
      if (assess.length) grants.push({ role: 'ASSESSOR', resultTypes: scopeOf(assess, cat) });
      if (leadTypes.length) grants.push({ role: 'LEAD_ASSESSOR', resultTypes: scopeOf(leadTypes, cat) });
      return grants;
    }
  }
}

/**
 * Changing the role between Assessor and Lead assessor keeps the result types the person covers:
 * they all move to the new role (P2-4107: it used to widen the scope to all types). Other roles
 * leave the lists alone (they are not sent for global roles).
 */
export function typesForRole(
  role: TeamRole,
  assessTypes: readonly string[],
  leadTypes: readonly string[],
): { assessTypes: string[]; leadTypes: string[] } {
  const all = [...new Set([...assessTypes, ...leadTypes])];
  if (role === 'Assessor') return { assessTypes: all, leadTypes: [] };
  if (role === 'Lead assessor') return { assessTypes: [], leadTypes: all };
  return { assessTypes: [...assessTypes], leadTypes: [...leadTypes] };
}

/** The role the picks mean: any assessed type = Assessor; only led types = Lead assessor; none = keep. */
export function roleForTypes(current: TeamRole, assessTypes: readonly string[], leadTypes: readonly string[]): TeamRole {
  if (assessTypes.length) return 'Assessor';
  if (leadTypes.length) return 'Lead assessor';
  return current;
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
  const { role, lead, assessTypes, leadTypes, noRole } = roleOf(u.roles, cat);
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
    types: [...new Set([...assessTypes, ...leadTypes])],
    assessTypes,
    leadTypes,
    prog: [],
    programs: u.programs === 'all' ? [] : u.programs.map((id) => codeOfProgram(id, cat)),
    blocked,
    ...activityOf(u.lastSignInAt, now),
    invite: inviteOf(u),
    canResend: u.status === 'active' && u.accountType === 'custom' && u.invitation === 'sent' && !u.lastSignInAt,
    active: u.status === 'active',
    otherRoles: !sameGrants(u.roles, rolesFor(role, assessTypes, leadTypes, cat)),
    noRole,
    namesLocked: !!u.lastSignInAt,
  };
}

/** Account type rule (design integration review 5): CGIAR emails sign in with SSO, others get an invitation. */
export function accountTypeFor(email: string): 'sso' | 'custom' {
  return /@cgiar\.org$/i.test(email.trim()) ? 'sso' : 'custom';
}
