// @akili-spec assessment/step-1-assessment
import { CUSTOM_ELEMENTS_SCHEMA, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AccessControl } from '../core/access/access-control';
import { AuthSession } from '../core/auth/auth-session';
import { UnsentQueue } from '../core/http/unsent-queue';
import { NotificationsBell } from '../pages/workspace/notifications/notifications-bell';
import { QaTokensLoader, QaUnsentCenter } from '../ui';
import { ActiveCycle } from './active-cycle';
import { QaShell } from './qa-shell';
import { WorkspaceLayout } from './workspace-layout';

@Component({ template: '' })
class Blank {}

/**
 * FR-8 AC2 / DD-14: the review page's focus control collapses the shell's sidebar and the navigator together.
 * The shell is rendered with its real template; the assertions read its sidebar toggle, never the service alone.
 */
describe('WorkspaceLayout and the shell sidebar', () => {
  let router: Router;

  const render = async (url: string) => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: '', component: Blank },
          { path: 'results', component: Blank },
          { path: 'results/:code', component: Blank },
        ]),
        { provide: AuthSession, useValue: { user: signal(null), isSignedIn: () => true, signOut: vi.fn() } },
        { provide: UnsentQueue, useValue: { count: () => 0, clearMine: vi.fn() } },
        { provide: AccessControl, useValue: { canAny: () => false } },
        { provide: QaTokensLoader, useValue: {} },
      ],
    });
    // The bell and the unsent center have their own stores and specs; they are not under test here.
    TestBed.overrideComponent(QaShell, {
      remove: { imports: [NotificationsBell, QaUnsentCenter] },
      // Added after the shell's own `ActiveCycle`, so this one wins: no card requests.
      add: { schemas: [CUSTOM_ELEMENTS_SCHEMA], providers: [{ provide: ActiveCycle, useValue: { card: signal(null), refresh: vi.fn() } }] },
    });
    router = TestBed.inject(Router);
    await router.navigateByUrl(url);
    const fixture = TestBed.createComponent(QaShell);
    fixture.detectChanges();
    return fixture;
  };

  /** The shell's own sidebar toggle: its `aria-expanded` is the shell's `collapsed` binding. */
  const sidebarToggle = (el: HTMLElement): HTMLButtonElement =>
    el.querySelector<HTMLButtonElement>('button[aria-label="Collapse sidebar"], button[aria-label="Expand sidebar"]')!;

  it('the sidebar starts collapsed on a review page and expanded elsewhere (default per URL)', async () => {
    const fixture = await render('/results/9890');
    const el = fixture.nativeElement as HTMLElement;
    expect(sidebarToggle(el).getAttribute('aria-expanded')).toBe('false');
    expect(sidebarToggle(el).getAttribute('aria-label')).toBe('Expand sidebar');

    await router.navigateByUrl('/results');
    fixture.detectChanges();
    expect(sidebarToggle(el).getAttribute('aria-expanded')).toBe('true');
  });

  it('setFocus(true) collapses the shell sidebar and the navigator; setFocus(false) opens both', async () => {
    const fixture = await render('/results');
    const el = fixture.nativeElement as HTMLElement;
    const layout = TestBed.inject(WorkspaceLayout);
    expect(sidebarToggle(el).getAttribute('aria-expanded')).toBe('true');

    layout.setFocus(true);
    fixture.detectChanges();

    expect(sidebarToggle(el).getAttribute('aria-expanded')).toBe('false');
    expect(layout.navigatorCollapsed()).toBe(true);
    expect(layout.focus()).toBe(true);

    layout.setFocus(false);
    fixture.detectChanges();
    expect(sidebarToggle(el).getAttribute('aria-expanded')).toBe('true');
    expect(layout.navigatorCollapsed()).toBe(false);
  });

  it('the shell toggle writes the shared state (the review page sees the sidebar it shows)', async () => {
    const fixture = await render('/results');
    const el = fixture.nativeElement as HTMLElement;
    sidebarToggle(el).click();
    fixture.detectChanges();
    expect(TestBed.inject(WorkspaceLayout).menuCollapsed()).toBe(true);
    expect(sidebarToggle(el).getAttribute('aria-expanded')).toBe('false');
  });
});
