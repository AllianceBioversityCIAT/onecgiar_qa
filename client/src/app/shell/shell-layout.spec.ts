import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthProvider, AuthUser, Credentials } from '../auth/auth-provider';
import { ShellLayout } from './shell-layout';
import { ShellState } from './shell-state';

class FakeProvider extends AuthProvider {
  readonly isStub = true;
  signIn(credentials: Credentials): Promise<AuthUser> {
    return Promise.resolve({ email: credentials.email });
  }
}

@Component({ template: '<p>page</p>' })
class Page {}

async function setup() {
  localStorage.clear();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: '', component: ShellLayout, children: [{ path: '**', component: Page }] },
      ]),
      { provide: AuthProvider, useClass: FakeProvider },
    ],
  });
  const router = TestBed.inject(Router);
  await router.navigateByUrl('/overview');
  const fixture = TestBed.createComponent(ShellLayout);
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const opener = host.querySelector<HTMLButtonElement>('button[aria-controls="nav-drawer"]')!;
  const open = async () => {
    opener.click();
    await fixture.whenStable();
  };
  return { fixture, host, opener, open, router };
}

describe('ShellLayout', () => {
  it('toggles the collapsed rail through the shared state', async () => {
    const { fixture, host } = await setup();
    host.querySelector<HTMLButtonElement>('button[aria-controls="main-nav"]')!.click();
    await fixture.whenStable();
    expect(TestBed.inject(ShellState).collapsed()).toBe(true);
  });

  it('opens the drawer as a modal dialog', async () => {
    const { host, opener, open } = await setup();
    expect(host.querySelector('#nav-drawer')).toBeNull();
    await open();
    expect(opener.getAttribute('aria-expanded')).toBe('true');
    const drawer = host.querySelector('#nav-drawer')!;
    expect(drawer.getAttribute('role')).toBe('dialog');
    expect(drawer.getAttribute('aria-modal')).toBe('true');
  });

  it('closes on Escape and returns focus to the menu button', async () => {
    const { fixture, host, opener, open } = await setup();
    await open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();
    expect(host.querySelector('#nav-drawer')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('closes on scrim click and after navigating', async () => {
    const { fixture, host, open } = await setup();
    await open();
    host.querySelector<HTMLElement>('[data-testid="drawer-scrim"]')!.click();
    await fixture.whenStable();
    expect(host.querySelector('#nav-drawer')).toBeNull();

    await open();
    host.querySelector<HTMLAnchorElement>('#nav-drawer nav a[href="/results"]')!.click();
    await fixture.whenStable();
    expect(host.querySelector('#nav-drawer')).toBeNull();
  });
});
