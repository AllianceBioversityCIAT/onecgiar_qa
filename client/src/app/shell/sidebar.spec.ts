import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthProvider, AuthUser, Credentials } from '../auth/auth-provider';
import { AuthSession } from '../auth/auth-session';
import { Sidebar } from './sidebar';

class FakeProvider extends AuthProvider {
  readonly isStub = true;
  signIn(credentials: Credentials): Promise<AuthUser> {
    return Promise.resolve({ email: credentials.email });
  }
}

@Component({ template: '' })
class Blank {}

@Component({
  imports: [Sidebar],
  template: `<app-sidebar [collapsed]="collapsed()" (toggle)="toggles = toggles + 1" />`,
})
class Host {
  readonly collapsed = signal(false);
  toggles = 0;
}

async function setup(url = '/results') {
  sessionStorage.clear();
  TestBed.configureTestingModule({
    imports: [Host],
    providers: [
      provideRouter([
        { path: 'login', component: Blank },
        { path: '**', component: Blank },
      ]),
      { provide: AuthProvider, useClass: FakeProvider },
    ],
  });
  await TestBed.inject(AuthSession).signIn({ email: 'ana@cgiar.org', password: 'x' });
  const router = TestBed.inject(Router);
  await router.navigateByUrl(url);
  const fixture = TestBed.createComponent(Host);
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  return { fixture, host, router };
}

describe('Sidebar', () => {
  it('lists the two groups and five items of the mockup', async () => {
    const { host } = await setup();
    const headings = [...host.querySelectorAll('h2')].map((h) => h.textContent?.trim());
    expect(headings).toEqual(['Assessment', 'Administration']);
    const links = [...host.querySelectorAll<HTMLAnchorElement>('nav a')].map((a) => [
      a.textContent?.trim(),
      a.getAttribute('href'),
    ]);
    expect(links).toEqual([
      ['Overview', '/overview'],
      ['Results', '/results'],
      ['Cycle', '/cycle'],
      ['Fields', '/fields'],
      ['Assessors', '/assessors'],
    ]);
  });

  it('marks only the current page', async () => {
    const { host } = await setup('/results');
    const current = [...host.querySelectorAll('nav a[aria-current="page"]')];
    expect(current.map((a) => a.textContent?.trim())).toEqual(['Results']);
  });

  it('keeps labels for assistive technology when collapsed', async () => {
    const { fixture, host } = await setup();
    fixture.componentInstance.collapsed.set(true);
    await fixture.whenStable();
    const first = host.querySelector<HTMLAnchorElement>('nav a')!;
    expect(first.querySelector('span')!.classList).toContain('sr-only');
    expect(first.textContent?.trim()).toBe('Overview');
    expect(first.title).toBe('Overview');
    const toggle = host.querySelector<HTMLButtonElement>('button[aria-controls="main-nav"]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent?.trim()).toBe('Expand sidebar');
  });

  it('asks the layout to toggle', async () => {
    const { fixture, host } = await setup();
    host.querySelector<HTMLButtonElement>('button[aria-controls="main-nav"]')!.click();
    expect(fixture.componentInstance.toggles).toBe(1);
  });

  it('shows the user and signs out to the login screen', async () => {
    const { fixture, host, router } = await setup();
    expect(host.querySelector('[data-testid="user-email"]')?.textContent?.trim()).toBe(
      'ana@cgiar.org',
    );
    host.querySelector<HTMLButtonElement>('[data-testid="sign-out"]')!.click();
    await fixture.whenStable();
    expect(TestBed.inject(AuthSession).isSignedIn()).toBe(false);
    expect(router.url).toBe('/login');
  });
});
