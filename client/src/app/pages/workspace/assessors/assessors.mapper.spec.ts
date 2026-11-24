import { UserSummary } from '../../../core/api/users.models';
import { TeamCatalogs, accountTypeFor, activityOf, programsFor, rolesFor, toMember } from './assessors.mapper';

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

  it('LEAD_ASSESSOR on some types = Assessor with lead on; on all = Lead assessor role', () => {
    expect(toMember(user({ roles: [{ role: 'LEAD_ASSESSOR', resultTypes: ['id'] }] }), cat, NOW)).toMatchObject({
      role: 'Assessor',
      lead: true,
      types: ['Innovation development'],
    });
    expect(toMember(user({ roles: [{ role: 'LEAD_ASSESSOR', resultTypes: 'all' }] }), cat, NOW)).toMatchObject({
      role: 'Lead assessor',
      types: [],
    });
  });

  it('flags grants the one-role screen cannot show exactly', () => {
    const m = toMember(
      user({ roles: [{ role: 'ASSESSOR', resultTypes: ['kp'] }, { role: 'LEAD_ASSESSOR', resultTypes: ['pc'] }] }),
      cat,
      NOW,
    );
    expect(m.otherRoles).toBe(true);
    expect(toMember(user({ roles: [{ role: 'ADMIN' }, { role: 'PPU' }] }), cat, NOW)).toMatchObject({ role: 'QA lead', otherRoles: true });
  });

  it('rolesFor never sends Assessor and Lead on the same type; all types = "all"; no types = no role', () => {
    expect(rolesFor('Assessor', true, ['Knowledge product'], cat)).toEqual([{ role: 'LEAD_ASSESSOR', resultTypes: ['kp'] }]);
    expect(rolesFor('Assessor', false, ['Knowledge product', 'Innovation development', 'Policy change'], cat)).toEqual([
      { role: 'ASSESSOR', resultTypes: 'all' },
    ]);
    expect(rolesFor('Assessor', false, [], cat)).toEqual([]);
    expect(rolesFor('QA lead', false, [], cat)).toEqual([{ role: 'ADMIN' }]);
    expect(rolesFor('Third-party broker', false, [], cat)).toEqual([{ role: 'TPB' }]);
  });

  it('no grant at all is flagged "No role"; lead on every type stays a list (not the Lead assessor role)', () => {
    expect(toMember(user({ roles: [] }), cat, NOW)).toMatchObject({ noRole: true });
    expect(rolesFor('Assessor', true, ['Knowledge product', 'Innovation development', 'Policy change'], cat)).toEqual([
      { role: 'LEAD_ASSESSOR', resultTypes: ['kp', 'id', 'pc'] },
    ]);
  });

  it('unknown type keys and program ids survive a round trip (never dropped)', () => {
    const m = toMember(user({ roles: [{ role: 'ASSESSOR', resultTypes: ['old_type'] }], programs: [999] }), cat, NOW);
    expect(m.types).toEqual(['old_type']);
    expect(m.programs).toEqual(['#999']);
    expect(rolesFor('Assessor', false, m.types, cat)).toEqual([{ role: 'ASSESSOR', resultTypes: ['old_type'] }]);
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
