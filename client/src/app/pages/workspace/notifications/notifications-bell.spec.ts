import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthSession } from '../../../core/auth/auth-session';
import type { Assignment } from '../../../core/auth/auth.models';
import { NotificationsBell } from './notifications-bell';
import { NotificationsStore } from './notifications-store';

@Component({ template: '' })
class Stub {}

const ADMIN: readonly Assignment[] = [{ role: 'ADMIN' }];
const ASSESSOR: readonly Assignment[] = [{ role: 'ASSESSOR', resultTypeKey: 'innovation-development' }];

const text = (e: Element | null | undefined): string => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** A signed-in user with these role assignments; the real `AccessControl` reads it, so the bell decides as in the app. */
function signedInAs(assignments: readonly Assignment[]) {
  return {
    user: signal({ id: 1, email: 'qa.admin@cgiar.org', firstName: null, lastName: null, authSource: 'sso', assignments }),
    isSignedIn: signal(true),
    signOut: vi.fn(),
  };
}

function configure(assignments: readonly Assignment[]): void {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: '', component: Stub },
        { path: 'results', component: Stub },
        { path: 'notifications', component: Stub },
      ]),
      { provide: AuthSession, useValue: signedInAs(assignments) },
    ],
  });
}

/** Lets change detection and the store's dynamic import settle. */
async function settle(f: ComponentFixture<unknown>): Promise<void> {
  for (let i = 0; i < 4; i++) {
    f.detectChanges();
    await f.whenStable();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

async function renderBell(assignments: readonly Assignment[] = ADMIN): Promise<ComponentFixture<NotificationsBell>> {
  configure(assignments);
  const fixture = TestBed.createComponent(NotificationsBell);
  await settle(fixture);
  await TestBed.inject(NotificationsStore).load();
  await settle(fixture);
  return fixture;
}

const hostEl = (f: ComponentFixture<unknown>): HTMLElement => f.nativeElement;
const bell = (f: ComponentFixture<unknown>): HTMLAnchorElement => hostEl(f).querySelector('a[aria-label^="Notifications"]')!;

describe('NotificationsBell', () => {
  // (a) FR-1: as in PRMS, the bell says "Notifications" and shows the unread count in a pill; the accessible name says it too.
  it('(a) names the bell "Notifications, 2 unread" and shows "Notifications" with a 2 pill', async () => {
    const f = await renderBell();
    expect(bell(f), 'the bell').not.toBeNull();

    expect(bell(f).getAttribute('aria-label')).toBe('Notifications, 2 unread');
    expect(text(bell(f).querySelector('[data-count]')!), 'the pill').toBe('2');
    expect(text(bell(f)), 'the visible text').toBe('Notifications2');
  });

  // (b) FR-1: nothing unread, no pill and the plain name.
  it('(b) names the bell "Notifications" and shows no pill when nothing is unread', async () => {
    const f = await renderBell();
    TestBed.inject(NotificationsStore).markAllRead();
    await settle(f);

    expect(bell(f).getAttribute('aria-label')).toBe('Notifications');
    expect(bell(f).querySelector('[data-count]')).toBeNull();
  });

  // (c) FR-1: no bell, and no empty gap, for a user without ADMIN_ACCESS.
  it('(c) renders no bell element for a non-admin and its host is display: contents', async () => {
    configure(ASSESSOR);
    const f = TestBed.createComponent(NotificationsBell);
    await settle(f);
    const host = hostEl(f);

    expect(host.children.length, 'no bell element inside the host').toBe(0);
    expect(host.querySelector('button, a')).toBeNull();
    expect(host.classList.contains('contents'), 'host class').toBe(true);

    // jsdom loads no Tailwind: give it the one rule the utility stands for, so the host's computed box is what is checked.
    const style = document.createElement('style');
    style.textContent = '.contents { display: contents; }';
    document.head.append(style);
    try {
      expect(getComputedStyle(host).display).toBe('contents');
    } finally {
      style.remove();
    }
    // A user without access never loads the notifications.
    expect(TestBed.inject(NotificationsStore).state()).toBe('loading');
  });

  // (d) Juanpa, 2026-10-27: no panel. The bell is one link to the page at every width, 40 px on phones.
  it('(d) is a single link to /notifications at every width, with no panel', async () => {
    const f = await renderBell();
    const links = hostEl(f).querySelectorAll('a');

    expect(links.length, 'one link').toBe(1);
    expect(hostEl(f).querySelector('button'), 'no panel trigger').toBeNull();
    expect(bell(f).getAttribute('href')).toBe('/notifications');
    expect(bell(f).classList).toContain('size-10');
    expect(bell(f).classList).not.toContain('hidden');
    expect(bell(f).classList).not.toContain('sm:hidden');
  });

  // (e) Activating the bell opens the page, and the bell is marked current there.
  it('(e) opens /notifications and is marked as the current page there', async () => {
    const f = await renderBell();
    const router = TestBed.inject(Router);
    expect(bell(f).getAttribute('aria-current')).toBeNull();

    bell(f).click();
    await settle(f);

    expect(router.url).toBe('/notifications');
    expect(bell(f).getAttribute('aria-current')).toBe('page');
    expect(document.querySelector('[role="dialog"]'), 'no panel opens').toBeNull();
  });
});
