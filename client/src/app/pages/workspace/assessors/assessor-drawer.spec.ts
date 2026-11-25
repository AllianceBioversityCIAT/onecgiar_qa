import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { CatalogsApi } from '../../../core/api/catalogs-api';
import { UsersApi } from '../../../core/api/users-api';
import { UserSummary } from '../../../core/api/users.models';
import { Toasts } from '../../../core/http/toasts';
import { AssessorDrawer } from './assessor-drawer';
import { AssessorsStore } from './assessors-store';

// P2-4107: one result-type picker per role (Assessor, Lead assessor); a type taken by one role is
// disabled in the other, "Select all" skips it, and changing the role keeps the covered types.

const mixed: UserSummary = {
  id: 7,
  email: 'ada@cgiar.org',
  firstName: 'Ada',
  lastName: 'Lovelace',
  nickname: 'Assessor AL',
  accountType: 'sso',
  status: 'active',
  lastSignInAt: '2026-11-20T11:00:00Z',
  invitation: 'none',
  roles: [
    { role: 'ASSESSOR', resultTypes: ['kp'] },
    { role: 'LEAD_ASSESSOR', resultTypes: ['pc'] },
  ],
  programs: 'all',
  exclusions: [],
};

describe('AssessorDrawer result types per role (P2-4107)', () => {
  let replace: ReturnType<typeof vi.fn>;

  beforeAll(() => {
    Element.prototype.scrollIntoView ??= () => undefined;
  });

  async function settle(fixture: { whenStable(): Promise<unknown> }) {
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r, 30));
    await fixture.whenStable();
  }

  async function render() {
    replace = vi.fn(() => of({ ...mixed, exclusionHistory: [] }));
    TestBed.configureTestingModule({
      providers: [
        AssessorsStore,
        { provide: UsersApi, useValue: { listAll: () => of([mixed]), replace, create: vi.fn() } },
        {
          provide: CatalogsApi,
          useValue: {
            resultTypes: () =>
              of([
                { key: 'kp', name: 'Knowledge product' },
                { key: 'id', name: 'Innovation development' },
                { key: 'pc', name: 'Policy change' },
              ]),
            sciencePrograms: () => of([]),
          },
        },
        { provide: Toasts, useValue: { error: vi.fn(), success: vi.fn(), info: vi.fn() } },
      ],
    });
    await TestBed.inject(AssessorsStore).load();
    const fixture = TestBed.createComponent(AssessorDrawer);
    fixture.componentRef.setInput('session', { mode: 'edit', id: '7', confirmRemove: false, seq: 1 });
    fixture.componentRef.setInput('open', true);
    fixture.autoDetectChanges();
    await settle(fixture);
    return fixture;
  }

  const trigger = (label: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('qa-multi-select button')].find((b) =>
      b.getAttribute('aria-label')?.startsWith(label + ':'),
    )!;
  const option = (text: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] [role="checkbox"]')].find((b) => b.textContent?.includes(text))!;
  const bulk = (text: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent?.trim() === text)!;

  afterEach(() => document.querySelectorAll('.cdk-overlay-container').forEach((n) => (n.innerHTML = '')));

  it('shows both pickers with the saved types, and no fixed "All result types" box', async () => {
    await render();
    expect(trigger('Assessor on').textContent).toContain('Knowledge product');
    expect(trigger('Lead assessor on').textContent).toContain('Policy change');
    expect(document.body.textContent).not.toContain('Included in the lead assessor role');
  });

  it('a type led by this person is disabled in the Assessor picker and Select all skips it', async () => {
    const fixture = await render();
    trigger('Assessor on').click();
    await settle(fixture);
    const pc = option('Policy change');
    expect(pc.disabled).toBe(true);
    expect(pc.textContent).toContain('Lead assessor');
    pc.click();
    bulk('Select all').click();
    await settle(fixture);
    expect(trigger('Assessor on').textContent).toContain('Knowledge product, Innovation development');
    expect(trigger('Lead assessor on').textContent).toContain('Policy change');
  });

  it('changing the role to Lead assessor moves their types to the lead picker (nothing widens)', async () => {
    const fixture = await render();
    const select = [...document.querySelectorAll<HTMLButtonElement>('qa-select button')].find((b) => b.getAttribute('aria-label')?.startsWith('Role'))!;
    select.click();
    await settle(fixture);
    [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.textContent?.includes('Lead assessor'))!.click();
    await settle(fixture);
    expect(trigger('Lead assessor on').textContent).toContain('Knowledge product, Policy change');
    expect(trigger('Assessor on').textContent).toContain('None');
  });
});
