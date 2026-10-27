import { Component, WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NavigationEnd, Router, provideRouter } from '@angular/router';
import { AuthSession } from '../../../core/auth/auth-session';
import type { Assignment } from '../../../core/auth/auth.models';
import { UnsentQueue } from '../../../core/http/unsent-queue';
import { QaShell } from '../../../shell/qa-shell';
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

/** Only what the shell and `qa-unsent-center` read: an empty queue. */
const emptyQueue = {
  count: signal(0),
  items: signal([]),
  awaitingDecision: signal([]),
  keepAwaiting: vi.fn(),
  clearMine: vi.fn(),
};

function configure(assignments: readonly Assignment[]): void {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: '', component: Stub },
        { path: 'results', component: Stub },
        { path: 'results/:code', component: Stub },
        { path: 'notifications', component: Stub },
      ]),
      { provide: AuthSession, useValue: signedInAs(assignments) },
      { provide: UnsentQueue, useValue: emptyQueue },
    ],
  });
}

/** Lets change detection, the store's dynamic import, the overlay and its close animation settle. */
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
const bellButton = (f: ComponentFixture<unknown>): HTMLButtonElement => hostEl(f).querySelector('button[aria-label^="Notifications"]')!;
/** The panel lives in the overlay container, outside the fixture. */
const panel = (): HTMLElement | null => document.querySelector<HTMLElement>('[role="dialog"][aria-label="Notifications"]');
const panelRows = (): HTMLElement[] => Array.from(panel()?.querySelectorAll<HTMLElement>('[data-row]') ?? []);
const panelButton = (label: string): HTMLButtonElement | undefined =>
  Array.from(panel()?.querySelectorAll('button') ?? []).find((b) => text(b) === label);

/** Opens the panel the way a keyboard or mouse user does: the bell has focus, then it is activated. */
async function openPanel(f: ComponentFixture<unknown>): Promise<void> {
  const button = bellButton(f);
  button.focus();
  button.click();
  await settle(f);
  expect(panel(), 'the panel opens').not.toBeNull();
}

/** The URL a notification's target opens, as the router writes it. */
function urlOf(router: Router, target: { path: string; queryParams?: Readonly<Record<string, string>> }): string {
  return router.serializeUrl(router.createUrlTree([target.path], { queryParams: target.queryParams }));
}

describe('NotificationsBell', () => {
  // jsdom has no ResizeObserver, which spartan's brain primitives (the segmented control) read after render.
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn(); });
  });
  afterEach(() => vi.unstubAllGlobals());

  // (a) FR-1: unread notifications show as a dot and in the accessible name, never as a number on the bell.
  it('(a) names the bell "Notifications, 4 unread" and shows a dot, with no number on it', async () => {
    const f = await renderBell();
    const button = bellButton(f);

    expect(button.getAttribute('aria-label')).toBe('Notifications, 4 unread');
    expect(button.querySelector('[data-dot]'), 'the dot').not.toBeNull();
    expect(text(button), 'no text on the bell').toBe('');
    expect(Array.from(button.querySelectorAll('*')).filter((e) => text(e) === '4')).toEqual([]);
  });

  // (b) FR-1: nothing unread, no dot and the plain name.
  it('(b) names the bell "Notifications" and shows no dot when nothing is unread', async () => {
    const f = await renderBell();
    TestBed.inject(NotificationsStore).markAllRead();
    await settle(f);

    expect(bellButton(f).getAttribute('aria-label')).toBe('Notifications');
    expect(bellButton(f).querySelector('[data-dot]')).toBeNull();
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

  // (d) FR-5, FR-7: opening a row reads it, closes the panel, and goes to its target.
  it('(d) opening a row closes the panel, marks it read and navigates to its target', async () => {
    const f = await renderBell();
    const store = TestBed.inject(NotificationsStore);
    const router = TestBed.inject(Router);
    await openPanel(f);

    const first = store.items()[0];
    expect(first.unread).toBe(true);
    panelRows()[0].click();
    await settle(f);

    expect(panel(), 'the panel is closed').toBeNull();
    expect(store.unreadCount()).toBe(3);
    expect(bellButton(f).getAttribute('aria-label')).toBe('Notifications, 3 unread');
    expect(router.url).toBe(urlOf(router, first.target));
  });

  // (e) FR-2: "View all notifications" closes the panel and opens the page.
  it('(e) "View all notifications" closes the panel and navigates to /notifications', async () => {
    const f = await renderBell();
    const router = TestBed.inject(Router);
    await openPanel(f);

    panelButton('View all notifications')!.click();
    await settle(f);

    expect(panel(), 'the panel is closed').toBeNull();
    expect(router.url).toBe('/notifications');
  });

  // (f) FR-2, FR-9: Escape closes the real popover and focus goes back to the bell; the page does not move.
  it('(f) Escape closes the panel and returns focus to the bell, without navigating', async () => {
    const f = await renderBell();
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/results?stage=r1-one');
    await settle(f);
    await openPanel(f);

    // Focus is inside the panel, as it is once a keyboard user has moved in.
    panelRows()[0].focus();
    expect(panel()!.contains(document.activeElement)).toBe(true);
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle(f);

    expect(panel(), 'the panel is closed').toBeNull();
    expect(document.activeElement).toBe(bellButton(f));
    expect(router.url).toBe('/results?stage=r1-one');
  });

  // (g) DD-11 part 2: a notification whose target is the page's own URL must not re-expand a collapsed sidebar.
  it('(g) a shell collapsed by hand stays collapsed after opening a notification whose target is the current URL', async () => {
    configure(ADMIN);
    const shell = TestBed.createComponent(QaShell);
    const router = TestBed.inject(Router);
    const store = TestBed.inject(NotificationsStore);
    await settle(shell);
    await store.load();

    const target = store.items()[0].target;
    await router.navigateByUrl(urlOf(router, target));
    await settle(shell);

    const collapsed = (shell.componentInstance as unknown as { collapsed: WritableSignal<boolean> }).collapsed;
    expect(collapsed(), 'a list URL starts expanded').toBe(false);
    collapsed.set(true);
    await settle(shell);
    const toggle = hostEl(shell).querySelector<HTMLButtonElement>('button[aria-label="Expand sidebar"]');
    expect(toggle, 'the sidebar is collapsed').not.toBeNull();

    let navigations = 0;
    const sub = router.events.subscribe((e) => e instanceof NavigationEnd && navigations++);
    const urlBefore = router.url;
    await openPanel(shell);
    panelRows()[0].click();
    await settle(shell);
    sub.unsubscribe();

    expect(collapsed(), 'the sidebar kept its state').toBe(true);
    expect(hostEl(shell).querySelector('button[aria-label="Expand sidebar"]')).not.toBeNull();
    expect(navigations, 'the same-URL navigation really ran').toBeGreaterThanOrEqual(1);
    expect(router.url, 'the URL string did not change').toBe(urlBefore);
  });

  // FR-2: at most 8 rows, the Unread switch narrows them and "Mark all as read" goes away with the last unread one.
  it('lists at most 8 rows, narrows to the 4 unread, and hides "Mark all as read" once nothing is unread', async () => {
    const f = await renderBell();
    const store = TestBed.inject(NotificationsStore);
    expect(store.items().length).toBeGreaterThan(8);
    await openPanel(f);
    expect(panelRows().length).toBe(8);

    const unread = Array.from(panel()!.querySelectorAll<HTMLLabelElement>('label')).find((l) => text(l).startsWith('Unread'))!;
    expect(text(unread)).toBe('Unread 4');
    unread.click();
    await settle(f);
    expect(panelRows().length).toBe(4);

    panelButton('Mark all as read')!.click();
    await settle(f);
    expect(store.unreadCount()).toBe(0);
    expect(panelButton('Mark all as read')).toBeUndefined();
    expect(text(panel())).toContain('No unread notifications');
    expect(panel()!.contains(document.activeElement), 'focus stays inside the panel').toBe(true);
  });

  // FR-2 phone: below 640 px the bell is a link to the page, and only one of the two is shown at a time.
  it('has a link to /notifications for phones, swapped with the button by breakpoint', async () => {
    const f = await renderBell();
    const link = hostEl(f).querySelector<HTMLAnchorElement>('a')!;

    expect(link.getAttribute('href')).toBe('/notifications');
    expect(link.getAttribute('aria-label')).toBe('Notifications, 4 unread');
    expect(link.classList).toContain('size-10');
    expect(link.classList).toContain('sm:hidden');
    expect(bellButton(f).classList).toContain('hidden');
    expect(bellButton(f).classList).toContain('sm:flex');
  });
});
