import { TimelineUser } from '../../../core/api/cycles.models';
import { UserSummary } from '../../../core/api/users.models';
import { assignedByRole, candidatesFor, peopleSummary, personName } from './timeline-people.logic';

const user = (id: number, first: string | null, roles: UserSummary['roles'], status: UserSummary['status'] = 'active'): UserSummary => ({
  id,
  email: `u${id}@cgiar.org`,
  firstName: first,
  lastName: first ? 'Doe' : null,
  nickname: null,
  accountType: 'sso',
  status,
  lastSignInAt: null,
  invitation: 'none',
  roles,
  programs: 'all',
  exclusions: [],
});

const assignment = (assignmentId: number, userId: number, role: TimelineUser['role'], first: string | null = null): TimelineUser => ({
  assignmentId,
  userId,
  firstName: first,
  lastName: first ? 'Doe' : null,
  email: `u${userId}@cgiar.org`,
  role,
  assignedAt: '2026-11-10T15:00:00Z',
});

describe('timeline-people.logic', () => {
  it('personName: first and last name, or the email when the account has no name (SSO)', () => {
    expect(personName({ firstName: 'Ana', lastName: 'Ruiz', email: 'a@x.org' })).toBe('Ana Ruiz');
    expect(personName({ firstName: null, lastName: null, email: 'y.zuniga@cgiar.org' })).toBe('y.zuniga@cgiar.org');
    expect(personName({ firstName: '  ', lastName: null, email: 'b@x.org' })).toBe('b@x.org');
  });

  it('candidatesFor: only active people with a grant of that role, minus the ones already assigned to it', () => {
    const team = [
      user(1, 'Zoe', [{ role: 'ASSESSOR', resultTypes: 'all' }]),
      user(2, 'Ana', [{ role: 'ASSESSOR', resultTypes: ['KP'] }, { role: 'TPB' }]),
      user(3, 'Inactive', [{ role: 'ASSESSOR', resultTypes: 'all' }], 'inactive'),
      user(4, 'Admin', [{ role: 'ADMIN' }]),
      user(5, 'Lead', [{ role: 'LEAD_ASSESSOR', resultTypes: 'all' }]),
    ];
    const assigned = [assignment(10, 1, 'ASSESSOR'), assignment(11, 2, 'TPB')];

    expect(candidatesFor('ASSESSOR', team, assigned).map((u) => u.id)).toEqual([2]);
    // Assigned as TPB does not hide her from the assessors list, and the reverse.
    expect(candidatesFor('TPB', team, assigned).map((u) => u.id)).toEqual([]);
    expect(candidatesFor('LEAD_ASSESSOR', team, assigned).map((u) => u.id)).toEqual([5]);
    expect(candidatesFor('PPU', team, assigned)).toEqual([]);
  });

  it('candidatesFor: sorted by name, nameless accounts by email', () => {
    const team = [user(1, 'Zoe', [{ role: 'PPU' }]), user(2, null, [{ role: 'PPU' }]), user(3, 'Ana', [{ role: 'PPU' }])];
    expect(candidatesFor('PPU', team, []).map((u) => u.id)).toEqual([3, 2, 1]);
  });

  it('assignedByRole: every role present (empty when nobody), sorted by name', () => {
    const groups = assignedByRole([assignment(1, 1, 'ASSESSOR', 'Zoe'), assignment(2, 2, 'ASSESSOR', 'Ana'), assignment(3, 3, 'PPU', 'Lu')]);
    expect(groups.ASSESSOR.map((u) => u.userId)).toEqual([2, 1]);
    expect(groups.LEAD_ASSESSOR).toEqual([]);
    expect(groups.TPB).toEqual([]);
    expect(groups.PPU.map((u) => u.userId)).toEqual([3]);
  });

  it('peopleSummary: counts per role with singular and plural', () => {
    expect(peopleSummary([assignment(1, 1, 'ASSESSOR'), assignment(2, 2, 'ASSESSOR'), assignment(3, 3, 'LEAD_ASSESSOR')])).toBe(
      '2 assessors · 1 lead assessor · 0 third-party brokers · 0 PPU',
    );
  });
});
