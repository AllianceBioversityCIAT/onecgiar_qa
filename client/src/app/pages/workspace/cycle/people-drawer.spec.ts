import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AssignableRole, TimelineUser } from '../../../core/api/cycles.models';
import { UserSummary } from '../../../core/api/users.models';
import { Timeline } from './cycle.mock';
import { PeopleDrawer } from './people-drawer';
import { TimelinePeople } from './timeline-people';
import { assignedByRole } from './timeline-people.logic';

const nameless: TimelineUser = {
  assignmentId: 2,
  userId: 99,
  firstName: null,
  lastName: null,
  email: 'lead.sso.user.with.a.long.address@cgiar.org',
  role: 'LEAD_ASSESSOR',
  assignedAt: '2026-11-10T15:00:00Z',
};
const named: TimelineUser = { ...nameless, assignmentId: 1, userId: 7, firstName: 'Ana', lastName: 'Ruiz', email: 'a.ruiz@cgiar.org', role: 'ASSESSOR' };
const candidate = { id: 11, email: 'bo@cgiar.org', firstName: 'Bo', lastName: 'Doe', status: 'active', roles: [{ role: 'ASSESSOR' }] } as unknown as UserSummary;

/** The drawer's store with fixed data: no HTTP. */
class FakePeople {
  readonly state = signal('ready');
  readonly loadError = signal('');
  readonly busy = signal<ReadonlySet<string>>(new Set());
  readonly roleError = signal({});
  private readonly users = signal<readonly TimelineUser[]>([named, nameless]);
  readonly byRole = computed(() => assignedByRole(this.users()));
  readonly summary = computed(() => '1 assessor · 1 lead assessor · 0 third-party brokers · 0 PPU');
  candidates(role: AssignableRole): readonly UserSummary[] {
    return role === 'ASSESSOR' ? [candidate] : [];
  }
  load = vi.fn(() => Promise.resolve(true));
  isAdding = () => false;
  isRemoving = () => false;
}

const TIMELINE: Timeline = { id: '7', name: 'July', kind: 'Sub-timeline', status: 'Live', results: 0, programs: [], types: [], steps: [], apiId: 7, version: 1 };

describe('PeopleDrawer', () => {
  const render = () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    TestBed.overrideComponent(PeopleDrawer, { set: { providers: [{ provide: TimelinePeople, useClass: FakePeople }] } });
    const fixture = TestBed.createComponent(PeopleDrawer);
    fixture.componentRef.setInput('timeline', TIMELINE);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    return fixture;
  };
  const section = (root: HTMLElement, role: string) => root.ownerDocument.querySelector<HTMLElement>(`[aria-labelledby="people-${role}"]`)!;

  it('a person without a name shows the whole email (it wraps, never cut with "…")', () => {
    const fixture = render();
    const row = section(fixture.nativeElement, 'LEAD_ASSESSOR').querySelector('li')!;
    const email = [...row.querySelectorAll('span')].find((s) => s.textContent?.trim() === nameless.email)!;

    expect(email).toBeTruthy();
    expect(email.classList).toContain('break-all');
    expect(email.classList).not.toContain('truncate');
  });

  it('a role nobody else holds says where to give it (link to Assessors); a role with candidates does not', () => {
    const fixture = render();
    const lead = section(fixture.nativeElement, 'LEAD_ASSESSOR');
    const assessors = section(fixture.nativeElement, 'ASSESSOR');

    expect(lead.querySelector('a[href="/assessors"]')?.textContent?.trim()).toBe('Assessors');
    expect(assessors.querySelector('a[href="/assessors"]')).toBeNull();
  });
});
