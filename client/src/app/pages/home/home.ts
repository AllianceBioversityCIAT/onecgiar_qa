import { Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthSession } from '../../auth/auth-session';
import { LOGIN_PATH } from '../../auth/auth-guards';
import { QaShell } from '../../shell/qa-shell';
import { OverviewView } from '../workspace/overview/overview-view';

/** QA workspace home: the mockup's app frame showing the Overview view. */
@Component({
  selector: 'app-home',
  imports: [QaShell, OverviewView],
  template: `
    <qa-shell>
      <qa-overview-view />
    </qa-shell>
  `,
  host: { class: 'block' },
})
export class HomePage {
  private readonly session = inject(AuthSession);
  private readonly router = inject(Router);

  protected readonly email = computed(() => this.session.user()?.email ?? '');

  protected signOut(): void {
    this.session.signOut();
    void this.router.navigateByUrl(LOGIN_PATH);
  }
}
