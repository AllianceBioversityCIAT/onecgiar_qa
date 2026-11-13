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
  readonly users = signal<readonly TimelineUser[]>([named, nameless]);
  readonly byRole = computed(() => assignedByRole(this.users()));
  readonly summary = computed(() => '1 assessor · 1 lead assessor · 0 third-party brokers · 0 PPU');
  candidates(role: AssignableRole): readonly UserSummary[] {
    return role === 'ASSESSOR' ? [candidate] : [];
  }
  load = vi.fn(() => Promise.resolve(true));
  isAdding = (_role: AssignableRole) => false;
  isRemoving = () => false;
}

const TIMELINE: Timeline = { id: '7', name: 'July', kind: 'Sub-timeline', status: 'Live', results: 0, programs: [], types: [], steps: [], apiId: 7, version: 1 };

describe('PeopleDrawer', () => {
  const render = (timeline: Timeline = TIMELINE) => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    TestBed.overrideComponent(PeopleDrawer, { set: { providers: [{ provide: TimelinePeople, useClass: FakePeople }] } });
    const fixture = TestBed.createComponent(PeopleDrawer);
    fixture.componentRef.setInput('timeline', timeline);
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

  const hasAdd = (el: HTMLElement) => [...el.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Add');

  it('a role with no one left to add shows only one line: no empty picker, no disabled Add', () => {
    const fixture = render();
    const lead = section(fixture.nativeElement, 'LEAD_ASSESSOR');
    const assessors = section(fixture.nativeElement, 'ASSESSOR');

    expect(hasAdd(lead)).toBe(false);
    expect(lead.querySelector('qa-select')).toBeNull();
    expect(lead.textContent).toContain('give them the role in Assessors');
    expect(hasAdd(assessors)).toBe(true);
  });

  it('a role nobody holds at all says only people with the role can be added', () => {
    const fixture = render();
    const tpb = section(fixture.nativeElement, 'TPB');
    expect(tpb.textContent).toContain('Only people with this role can be added');
    expect(hasAdd(tpb)).toBe(false);
  });

  it('after adding the last person who holds the role, it says everyone is here (not "only people with this role")', () => {
    const fixture = render();
    const lead = section(fixture.nativeElement, 'LEAD_ASSESSOR');
    expect(lead.textContent).toContain('Everyone who holds this role is already here');
    expect(lead.textContent).not.toContain('Only people with this role can be added');
  });

  it('keeps the picker while an add runs, even if that empties the list', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    class Adding extends FakePeople {
      override isAdding = (role: AssignableRole) => role === 'LEAD_ASSESSOR';
    }
    TestBed.overrideComponent(PeopleDrawer, { set: { providers: [{ provide: TimelinePeople, useClass: Adding }] } });
    const fixture = TestBed.createComponent(PeopleDrawer);
    fixture.componentRef.setInput('timeline', TIMELINE);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    expect(hasAdd(section(fixture.nativeElement, 'LEAD_ASSESSOR'))).toBe(true);
  });

  it('shows only the roles the timeline uses (a fast track without lead nor broker steps), and says only those', () => {
    const step = (audienceKey: 'assessors' | 'programs' | 'ppu') => ({ name: audienceKey, start: '01 Nov 2026', end: '02 Nov 2026', audienceKey }) as Timeline['steps'][number];
    const fast: Timeline = { ...TIMELINE, steps: [step('assessors'), step('programs'), step('ppu')] };
    const fixture = render(fast);
    const doc = (fixture.nativeElement as HTMLElement).ownerDocument;

    expect(section(fixture.nativeElement, 'ASSESSOR')).toBeTruthy();
    expect(section(fixture.nativeElement, 'PPU')).toBeTruthy();
    expect(doc.querySelector('[aria-labelledby="people-TPB"]')).toBeNull();
    // The lead assessor still shows: someone is assigned there, so they never hide.
    expect(section(fixture.nativeElement, 'LEAD_ASSESSOR')).toBeTruthy();
    expect(doc.body.textContent).toContain('1 assessor · 1 lead assessor · 0 PPU');
    expect(doc.body.textContent).not.toContain('third-party broker');
  });
});
