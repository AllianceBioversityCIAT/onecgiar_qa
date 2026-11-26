import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AccessControl } from '../core/access/access-control';
import { AuthSession } from '../core/auth/auth-session';
import { UnsavedChanges } from '../core/forms/unsaved-changes';
import { UnsentQueue } from '../core/http/unsent-queue';
import { QaTokensLoader } from '../ui';
import { ActiveCycle } from './active-cycle';
import { QaShell } from './qa-shell';
import { WorkspaceLayout } from './workspace-layout';

describe('QaShell — sign out', () => {
  const session = { user: signal(null), isSignedIn: () => true, signOut: vi.fn(() => Promise.resolve()) };
  const unsent = { count: () => 0, clearMine: vi.fn() };

  const create = () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthSession, useValue: session },
        { provide: UnsentQueue, useValue: unsent },
        { provide: AccessControl, useValue: { canAny: () => false } },
        { provide: QaTokensLoader, useValue: {} },
      ],
    });
    // Only the sign-out decision is under test: no template, no card requests.
    TestBed.overrideComponent(QaShell, { set: { template: '', providers: [{ provide: ActiveCycle, useValue: { card: signal(null), refresh: vi.fn() } }] } });
    return TestBed.createComponent(QaShell).componentInstance as unknown as { signOut(): void };
  };

  afterEach(() => vi.restoreAllMocks());

  it('a drawer half filled in asks first; "Cancel" keeps the session and the work (BUG-6)', () => {
    const shell = create();
    TestBed.inject(UnsavedChanges).register(() => true);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    session.signOut.mockClear();

    shell.signOut();

    expect(confirm).toHaveBeenCalledWith('You have unsaved changes. Leave this page and discard them?');
    expect(session.signOut).not.toHaveBeenCalled();
  });

  it('the sidebar follows WorkspaceLayout: the review "Focus" control collapses it (DD-14)', () => {
    const shell = create() as unknown as { collapsed(): boolean; toggleMenu(): void };
    const layout = TestBed.inject(WorkspaceLayout);
    expect(shell.collapsed()).toBe(false);

    layout.setFocus(true);
    expect(shell.collapsed()).toBe(true);

    // The shell's own toggle writes to the same state the review page reads.
    shell.toggleMenu();
    expect(layout.menuCollapsed()).toBe(false);
  });

  it('nothing unsaved: signs out without asking', () => {
    const shell = create();
    const confirm = vi.spyOn(window, 'confirm');
    session.signOut.mockClear();

    shell.signOut();

    expect(confirm).not.toHaveBeenCalled();
    expect(session.signOut).toHaveBeenCalledTimes(1);
  });
});

describe('QaShell — top-bar search', () => {
  const create = (canRead: boolean) => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthSession, useValue: { user: signal(null), isSignedIn: () => true, signOut: vi.fn() } },
        { provide: UnsentQueue, useValue: { count: () => 0, clearMine: vi.fn() } },
        { provide: AccessControl, useValue: { canAny: () => canRead } },
        { provide: QaTokensLoader, useValue: {} },
      ],
    });
    TestBed.overrideComponent(QaShell, { set: { template: '', providers: [{ provide: ActiveCycle, useValue: { card: signal(null), refresh: vi.fn() } }] } });
    return TestBed.createComponent(QaShell).componentInstance as unknown as {
      canSearch(): boolean;
      searchResults(event: Event, box: HTMLInputElement): void;
    };
  };
  const box = (value: string) => Object.assign(document.createElement('input'), { value });

  it('shows only to whoever can open "Results in QA"', () => {
    expect(create(true).canSearch()).toBe(true);
    TestBed.resetTestingModule();
    expect(create(false).canSearch()).toBe(false);
  });

  it('Enter opens Results searched by code or title (trimmed), without reloading the page', () => {
    const shell = create(true);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const event = new Event('submit', { cancelable: true });

    shell.searchResults(event, box('  2341  '));

    expect(event.defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenCalledWith(['/results'], { queryParams: { q: '2341' }, queryParamsHandling: undefined });
  });

  it('on Results it keeps the timeline and filters; an empty box clears only the search', () => {
    const shell = create(true);
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'url', 'get').mockReturnValue('/results?timeline=4&status=in_review&q=old');
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    shell.searchResults(new Event('submit', { cancelable: true }), box('   '));

    expect(navigate).toHaveBeenCalledWith(['/results'], { queryParams: { q: null }, queryParamsHandling: 'merge' });
  });
});
