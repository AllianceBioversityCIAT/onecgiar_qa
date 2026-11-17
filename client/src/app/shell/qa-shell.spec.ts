import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AccessControl } from '../core/access/access-control';
import { AuthSession } from '../core/auth/auth-session';
import { UnsavedChanges } from '../core/forms/unsaved-changes';
import { UnsentQueue } from '../core/http/unsent-queue';
import { QaTokensLoader } from '../ui';
import { ActiveCycle } from './active-cycle';
import { QaShell } from './qa-shell';

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

  it('nothing unsaved: signs out without asking', () => {
    const shell = create();
    const confirm = vi.spyOn(window, 'confirm');
    session.signOut.mockClear();

    shell.signOut();

    expect(confirm).not.toHaveBeenCalled();
    expect(session.signOut).toHaveBeenCalledTimes(1);
  });
});
