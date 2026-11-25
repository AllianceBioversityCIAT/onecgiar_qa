import { UserSummary } from '../../../core/api/users.models';
import { TeamCatalogs, accountTypeFor, activityOf, programsFor, roleForTypes, rolesFor, toMember, typesForRole } from './assessors.mapper';

const cat: TeamCatalogs = {
  types: [
    { key: 'kp', name: 'Knowledge product' },
    { key: 'id', name: 'Innovation development' },
    { key: 'pc', name: 'Policy change' },
  ],
  programs: [
    { id: 441, code: 'SP01', name: 'Breeding for Tomorrow' },
    { id: 442, code: 'SP02', name: 'Rice' },
  ],
};
const NOW = Date.parse('2026-10-20T12:00:00Z');

const user = (over: Partial<UserSummary> = {}): UserSummary => ({
  id: 7,
  email: 'ada@cgiar.org',
  firstName: 'Ada',
  lastName: 'Lovelace',
  nickname: 'Assessor AL',
  accountType: 'sso',
  status: 'active',
  lastSignInAt: '2026-10-20T11:00:00Z',
  invitation: 'none',
  roles: [{ role: 'ASSESSOR', resultTypes: ['kp'] }],
  programs: 'all',
  exclusions: [],
  ...over,
});

describe('assessors mapper', () => {
  it('maps a plain assessor: names joined, keys to names, all programs, active this week', () => {
    const m = toMember(user(), cat, NOW);
    expect(m.id).toBe('7');
    expect(m.name).toBe('Ada Lovelace');
    expect(m.role).toBe('Assessor');
    expect(m.types).toEqual(['Knowledge product']);
    expect(m.lead).toBe(false);
    expect(m.programs).toEqual([]);
    expect(m.act).toBe('week');
    expect(m.last).toBe('1 hour ago');
    expect(m.otherRoles).toBe(false);
  });

  it('LEAD_ASSESSOR only = the Lead assessor role on exactly its types; "all" lists every type', () => {
    expect(toMember(user({ roles: [{ role: 'LEAD_ASSESSOR', resultTypes: ['id'] }] }), cat, NOW)).toMatchObject({
      role: 'Lead assessor',
      lead: true,
      assessTypes: [],
      leadTypes: ['Innovation development'],
      types: ['Innovation development'],
      otherRoles: false,
    });
    expect(toMember(user({ roles: [{ role: 'LEAD_ASSESSOR', resultTypes: 'all' }] }), cat, NOW)).toMatchObject({
      role: 'Lead assessor',
      leadTypes: ['Knowledge product', 'Innovation development', 'Policy change'],
      otherRoles: false,
    });
  });

  it('Assessor on some types + Lead on others (P2-4107) is shown exactly, not as "other roles"', () => {
    const m = toMember(
      user({ roles: [{ role: 'ASSESSOR', resultTypes: ['kp'] }, { role: 'LEAD_ASSESSOR', resultTypes: ['pc'] }] }),
      cat,
      NOW,
    );
    expect(m).toMatchObject({
      role: 'Assessor',
      lead: true,
      assessTypes: ['Knowledge product'],
      leadTypes: ['Policy change'],
      types: ['Knowledge product', 'Policy change'],
      otherRoles: false,
    });
    expect(toMember(user({ roles: [{ role: 'ADMIN' }, { role: 'PPU' }] }), cat, NOW)).toMatchObject({ role: 'QA lead', otherRoles: true });
  });

  it('rolesFor sends one grant per role with its own types; every type = "all"; no types = no role', () => {
    expect(rolesFor('Assessor', ['Knowledge product'], ['Policy change'], cat)).toEqual([
      { role: 'ASSESSOR', resultTypes: ['kp'] },
      { role: 'LEAD_ASSESSOR', resultTypes: ['pc'] },
    ]);
    expect(rolesFor('Assessor', ['Knowledge product', 'Innovation development', 'Policy change'], [], cat)).toEqual([
      { role: 'ASSESSOR', resultTypes: 'all' },
    ]);
    expect(rolesFor('Lead assessor', [], ['Knowledge product', 'Innovation development', 'Policy change'], cat)).toEqual([
      { role: 'LEAD_ASSESSOR', resultTypes: 'all' },
    ]);
    expect(rolesFor('Lead assessor', [], ['Policy change'], cat)).toEqual([{ role: 'LEAD_ASSESSOR', resultTypes: ['pc'] }]);
    expect(rolesFor('Assessor', [], [], cat)).toEqual([]);
    expect(rolesFor('QA lead', ['Knowledge product'], ['Policy change'], cat)).toEqual([{ role: 'ADMIN' }]);
    expect(rolesFor('Third-party broker', [], [], cat)).toEqual([{ role: 'TPB' }]);
  });

  it('rolesFor never sends the same type in both roles: the lead side keeps it', () => {
    expect(rolesFor('Assessor', ['Knowledge product', 'Policy change'], ['Policy change'], cat)).toEqual([
      { role: 'ASSESSOR', resultTypes: ['kp'] },
      { role: 'LEAD_ASSESSOR', resultTypes: ['pc'] },
    ]);
  });

  it('no grant at all is flagged "No role"', () => {
    expect(toMember(user({ roles: [] }), cat, NOW)).toMatchObject({ noRole: true, assessTypes: [], leadTypes: [] });
  });

  it('changing between Assessor and Lead assessor keeps the result types they cover (never widens to all)', () => {
    expect(typesForRole('Lead assessor', ['Knowledge product'], ['Policy change'])).toEqual({
      assessTypes: [],
      leadTypes: ['Knowledge product', 'Policy change'],
    });
    expect(typesForRole('Assessor', ['Knowledge product'], ['Policy change'])).toEqual({
      assessTypes: ['Knowledge product', 'Policy change'],
      leadTypes: [],
    });
    expect(typesForRole('PPU', ['Knowledge product'], ['Policy change'])).toEqual({
      assessTypes: ['Knowledge product'],
      leadTypes: ['Policy change'],
    });
  });

  it('roleForTypes: any assessed type = Assessor; only led types = Lead assessor; none keeps the pick', () => {
    expect(roleForTypes('Lead assessor', ['Knowledge product'], ['Policy change'])).toBe('Assessor');
    expect(roleForTypes('Assessor', [], ['Policy change'])).toBe('Lead assessor');
    expect(roleForTypes('Lead assessor', [], [])).toBe('Lead assessor');
  });

  it('user 1053 shape (Assessor on 8 types, Lead on Policy change) round-trips to the same grants', () => {
    const nine: TeamCatalogs = {
      types: ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 'pc'].map((key) => ({ key, name: key === 'pc' ? 'Policy change' : key.toUpperCase() })),
      programs: [],
    };
    const roles = [
      { role: 'ASSESSOR', resultTypes: ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'] },
      { role: 'LEAD_ASSESSOR', resultTypes: ['pc'] },
    ];
    const m = toMember(user({ roles }), nine, NOW);
    expect(m).toMatchObject({ role: 'Assessor', lead: true, leadTypes: ['Policy change'], otherRoles: false });
    expect(m.assessTypes.length).toBe(8);
    expect(rolesFor(m.role, m.assessTypes, m.leadTypes, nine)).toEqual(roles);
  });

  it('unknown type keys and program ids survive a round trip (never dropped)', () => {
    const m = toMember(user({ roles: [{ role: 'ASSESSOR', resultTypes: ['old_type'] }], programs: [999] }), cat, NOW);
    expect(m.types).toEqual(['old_type']);
    expect(m.programs).toEqual(['#999']);
    expect(rolesFor('Assessor', m.assessTypes, m.leadTypes, cat)).toEqual([{ role: 'ASSESSOR', resultTypes: ['old_type'] }]);
    expect(programsFor(m.programs, cat)).toEqual([999]);
    expect(m.otherRoles).toBe(false);
  });

  it('programs: [] means all (the server refuses an empty list); codes go as CLARISA ids', () => {
    expect(programsFor([], cat)).toBe('all');
    expect(programsFor(['SP02'], cat)).toEqual([442]);
    expect(toMember(user({ programs: [441] }), cat, NOW).programs).toEqual(['SP01']);
  });

  it('exclusions keep id and origin; dates as labels', () => {
    const m = toMember(
      user({ exclusions: [{ id: 5, programId: 442, origin: 'reporting', reason: null, since: '2026-02-12T09:00:00Z' }] }),
      cat,
      NOW,
    );
    expect(m.blocked).toEqual([{ code: 'SP02', reason: '', date: '12 Feb 2026', id: 5, origin: 'reporting' }]);
  });

  it('invitation: resend only for an active custom account that was sent one and never signed in', () => {
    const invited = toMember(user({ accountType: 'custom', invitation: 'sent', lastSignInAt: null }), cat, NOW);
    expect(invited).toMatchObject({ invite: 'pending', canResend: true, act: 'never' });
    expect(toMember(user({ accountType: 'custom', invitation: 'existing_account', lastSignInAt: null }), cat, NOW)).toMatchObject({
      invite: 'existing_account',
      canResend: false,
    });
    expect(toMember(user({ accountType: 'custom', invitation: 'sent', lastSignInAt: null, status: 'inactive' }), cat, NOW).canResend).toBe(false);
  });

  it('activity buckets and the account type rule', () => {
    expect(activityOf(null, NOW).act).toBe('never');
    expect(activityOf('2026-10-16T12:00:00Z', NOW)).toMatchObject({ act: 'stale', last: '4 days ago' });
    expect(accountTypeFor('Ada@CGIAR.org')).toBe('sso');
    expect(accountTypeFor('ada@gmail.com')).toBe('custom');
  });
});
