import { Location, NgOptimizedImage, NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { LOGIN_PATH } from '../auth/auth-guards';
import { AuthSession } from '../auth/auth-session';
import { QaTokensLoader } from '../ui';

interface NavItem {
  readonly label: string;
  readonly link: string;
  readonly exact: boolean;
  readonly icon: string;
}

const ASSESSMENT: readonly NavItem[] = [
  { label: 'Overview', link: '/', exact: true, icon: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z' },
  { label: 'Results', link: '/results', exact: false, icon: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5' },
];

const ADMINISTRATION: readonly NavItem[] = [
  { label: 'Cycle', link: '/cycle', exact: false, icon: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z' },
  { label: 'Fields', link: '/fields', exact: false, icon: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6' },
  { label: 'Assessors', link: '/assessors', exact: false, icon: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' },
];

/**
 * App frame from the "QA Platform" mockup: sidebar, top bar and the workspace area.
 * Used as the layout route of the workspace (child views render in the outlet) and by the home
 * page, which projects the Overview view.
 */
@Component({
  selector: 'qa-shell',
  imports: [NgOptimizedImage, NgTemplateOutlet, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './qa-shell.html',
  styleUrl: './qa-shell.css',
  host: {
    class: 'qa-tokens',
    '(document:keydown.escape)': 'closeOverlays()',
  },
})
export class QaShell {
  /** Registers the global stylesheet behind the host class qa-tokens (colors, font). */
  private readonly tokens = inject(QaTokensLoader);
  private readonly session = inject(AuthSession);
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  protected readonly assessment = ASSESSMENT;
  protected readonly administration = ADMINISTRATION;

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  /**
   * Desktop: sidebar shrinks to an icon rail. The review page starts collapsed (as in the mockup)
   * to leave room for its own section list; the user can still toggle it.
   */
  protected readonly collapsed = linkedSignal(() => /^\/results\/[^/?#]+/.test(this.url()));
  /** Mobile/tablet: sidebar opens as a drawer over the content. */
  protected readonly mobileNavOpen = signal(false);
  protected readonly userMenuOpen = signal(false);

  protected readonly email = computed(() => this.session.user()?.email ?? '');
  protected readonly initials = computed(() => {
    const name = this.email().split('@')[0] ?? '';
    const parts = name.split(/[._-]+/).filter(Boolean);
    const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2);
    return letters.toUpperCase();
  });

  protected back(): void {
    this.location.back();
  }

  protected forward(): void {
    this.location.forward();
  }

  protected closeOverlays(): void {
    this.mobileNavOpen.set(false);
    this.userMenuOpen.set(false);
  }

  protected signOut(): void {
    this.closeOverlays();
    this.session.signOut();
    void this.router.navigateByUrl(LOGIN_PATH);
  }
}
