import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthSession } from '../../../core/auth/auth-session';
import { OverviewView } from './overview-view';

/**
 * Overview still shows the figures of the design prototype (`overview.mock.ts`, `overview-roles.mock.ts`): it does
 * not read the API yet (P2-3913). Until it does, the page must say so before any figure (P2-4079: a tester read
 * "Annual report 2026" as the real Main batch).
 */
describe('OverviewView (still on the prototype data)', () => {
  beforeEach(() => {
    // The charts of the page size themselves with ResizeObserver, which jsdom does not have.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        readonly observe = vi.fn();
        readonly unobserve = vi.fn();
        readonly disconnect = vi.fn();
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const ADMIN_AND_ASSESSOR = [{ role: 'ADMIN' }, { role: 'ASSESSOR', resultTypeKey: 'policy_change' }];
  const render = async (as?: string, assignments: readonly object[] = ADMIN_AND_ASSESSOR): Promise<HTMLElement> => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthSession, useValue: { user: signal({ firstName: 'Ana', assignments }) } }],
    });
    if (as) await TestBed.inject(Router).navigate([], { queryParams: { as } });
    const fixture = TestBed.createComponent(OverviewView);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };
  const notice = (el: HTMLElement): Element | null => el.querySelector('[data-testid="overview-sample-data"]');

  it('says that the figures are sample data, not real QA data (admin view)', async () => {
    const el = await render();
    expect(notice(el)?.getAttribute('role')).toBe('note');
    expect(notice(el)?.textContent).toContain('Preview · sample data');
    expect(notice(el)?.textContent).toContain('not real QA data');
  });

  it('says it for a reviewing role too', async () => {
    const el = await render('assessor');
    expect(el.querySelector('qa-ov-your-work')).not.toBeNull(); // the reviewing-role body is the one on screen
    expect(notice(el)?.textContent).toContain('Preview · sample data');
  });

  it('offers "Viewing as" only among the roles the user holds, starting on the first one', async () => {
    const el = await render();
    expect(el.querySelector('qa-select[label="Viewing as"]')).not.toBeNull();
    expect(el.querySelector('qa-ov-cycle-hero')).not.toBeNull(); // admin first
  });

  it('shows an assessor only their own Overview, with no "Viewing as" and no admin figures (23-nov demo)', async () => {
    const el = await render('admin', [{ role: 'ASSESSOR', resultTypeKey: 'policy_change' }]);
    expect(el.querySelector('qa-select[label="Viewing as"]')).toBeNull();
    expect(el.querySelector('qa-ov-your-work')).not.toBeNull();
    expect(el.querySelector('qa-ov-cycle-hero')).toBeNull();
  });

  it('says it before the first figure of the page', async () => {
    const el = await render();
    const first = el.querySelector('qa-ov-cycle-hero, qa-ov-your-work, qa-ov-timeline-lanes, qa-ov-stages');
    expect(first).not.toBeNull();
    // DOCUMENT_POSITION_FOLLOWING: the figure comes after the notice.
    expect(notice(el)!.compareDocumentPosition(first!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
