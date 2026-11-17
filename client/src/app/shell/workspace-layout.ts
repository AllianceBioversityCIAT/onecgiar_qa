import { Service, computed, inject, linkedSignal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';

/** The review page of one result: the sidebar starts collapsed there to leave room for its navigator. */
const REVIEW_URL = /^\/results\/[^/?#]+/;

/**
 * Who owns the workspace collapse state (design DD-14). The shell reads `menuCollapsed`; the review
 * page's "Focus" control collapses the sidebar and its own section navigator together, without a DOM
 * query from the page into the shell.
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

  /**
   * The page, without query or fragment: a query change on the same page (the review's `?as=` role
   * preview, `review-view.ts`) must not undo the user's choice.
   */
  private readonly path = computed(() => this.url().split(/[?#]/)[0]);

  /** Desktop sidebar as an icon rail. Back to the default (collapsed on a review page) when the page changes. */
  readonly menuCollapsed = linkedSignal(() => REVIEW_URL.test(this.path()));
  /** The review page's section navigator as a rail. Open again when the page changes. */
  readonly navigatorCollapsed = linkedSignal<string, boolean>({ source: this.path, computation: () => false });

  /** Both collapsed: the "Focus" control shows as on. */
  readonly focused = computed(() => this.menuCollapsed() && this.navigatorCollapsed());

  /** One control for both (FR-8 AC2). */
  setFocus(on: boolean): void {
    this.menuCollapsed.set(on);
    this.navigatorCollapsed.set(on);
  }

  toggleMenu(): void {
    this.menuCollapsed.update((collapsed) => !collapsed);
  }
}
