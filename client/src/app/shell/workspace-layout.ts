// @akili-spec assessment/step-1-assessment
import { Service, computed, inject, linkedSignal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';

/** The review page (`/results/:code`): the shell starts with its menu collapsed there, as in the mockup. */
const REVIEW_URL = /^\/results\/[^/?#]+/;

/**
 * Layout of the workspace shared by the shell and the pages (DD-14): the shell's sidebar collapse and the
 * review navigator's rail. The review page's focus control collapses both at once (FR-8 AC2), without
 * reaching into the shell's DOM.
 */
@Service()
export class WorkspaceLayout {
  private readonly router = inject(Router);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  /** Desktop sidebar shrunk to an icon rail. Resets to the URL's default on every navigation. */
  readonly menuCollapsed = linkedSignal(() => REVIEW_URL.test(this.url()));
  /** The review page's section navigator shrunk to its rail. */
  readonly navigatorCollapsed = signal(false);
  /** Both collapsed: the review fields take the whole width. */
  readonly focus = computed(() => this.menuCollapsed() && this.navigatorCollapsed());

  /** The one focus control: collapses (or expands) the sidebar and the navigator together. */
  setFocus(on: boolean): void {
    this.menuCollapsed.set(on);
    this.navigatorCollapsed.set(on);
  }
}
