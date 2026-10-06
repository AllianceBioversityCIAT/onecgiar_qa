import { Component, booleanAttribute, computed, inject, input, output } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthSession } from '../auth/auth-session';
import { LOGIN_PATH } from '../auth/auth-guards';
import { NAV_GROUPS } from './nav-items';

const ICON_PANEL =
  'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM9.5 4v16';
const ICON_SIGN_OUT = 'M9 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3M15.5 16.5 20 12l-4.5-4.5M20 12H9';
const ICON_CLOSE = 'M18 6 6 18M6 6l12 12';

/** Glass sidebar: brand, main navigation and the signed-in user. Used as rail and as drawer. */
@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, RouterLinkActive],
  host: { class: 'block' },
  template: `
    <aside
      class="glass flex h-full flex-col overflow-hidden rounded-[1.75rem] text-[var(--glass-ink)] transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
      [class.narrow]="narrow()"
      [style.width]="drawer() ? '100%' : narrow() ? '4.5rem' : '16rem'"
    >
      <div
        class="flex shrink-0 items-center gap-2.5"
        [class]="narrow() ? 'flex-col pt-5' : 'h-16 pt-3 pr-3 pl-5'"
      >
        <svg
          aria-hidden="true"
          class="size-7 shrink-0 text-[var(--qa-mark)]"
          viewBox="0 0 32 32"
          fill="currentColor"
        >
          <path
            d="M16 15C11 3 3 4 4 10s6 6 12 5Zm0 0c5-12 13-11 12-5s-6 6-12 5Zm0 2c-5 12-13 11-12 5s6-6 12-5Zm0 0c5 12 13 11 12 5s-6-6-12-5Z"
          />
        </svg>
        @if (!narrow()) {
          <span class="min-w-0 leading-tight whitespace-nowrap">
            <span class="block font-bold tracking-tight">PRMS</span>
            <span class="block text-xs text-[var(--glass-muted)]">quality assurance</span>
          </span>
        }
        @if (!drawer()) {
          <button
            type="button"
            class="icon-btn"
            [class.ml-auto]="!narrow()"
            aria-controls="main-nav"
            [attr.aria-expanded]="!collapsed()"
            [attr.aria-label]="collapsed() ? 'Expand sidebar' : 'Collapse sidebar'"
            [attr.title]="collapsed() ? 'Expand sidebar' : 'Collapse sidebar'"
            (click)="toggle.emit()"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" class="size-5">
              <path [attr.d]="iconPanel" />
            </svg>
          </button>
        } @else {
          <button
            type="button"
            class="icon-btn ml-auto"
            aria-label="Close navigation"
            (click)="dismiss.emit()"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" class="size-5">
              <path [attr.d]="iconClose" />
            </svg>
          </button>
        }
      </div>

      <nav
        aria-label="Main"
        class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 pt-2 pb-4"
        [attr.id]="drawer() ? null : 'main-nav'"
      >
        @for (group of groups; track group.label) {
          <h2
            class="mt-5 mb-2 px-3 text-[0.6875rem] font-semibold tracking-[0.12em] whitespace-nowrap text-[var(--glass-muted)] uppercase first:mt-1"
            [class.sr-only]="narrow()"
          >
            {{ group.label }}
          </h2>
          @if (narrow() && !$first) {
            <div aria-hidden="true" class="mx-auto my-3 h-px w-6 bg-white/15"></div>
          }
          <ul class="grid gap-1">
            @for (item of group.items; track item.path) {
              <li>
                <a
                  class="nav-link"
                  [routerLink]="item.path"
                  routerLinkActive="is-active"
                  ariaCurrentWhenActive="page"
                  [attr.title]="narrow() ? item.label : null"
                  (click)="navigated.emit()"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" class="size-5 shrink-0">
                    <path [attr.d]="item.icon" />
                  </svg>
                  <span class="truncate whitespace-nowrap" [class.sr-only]="narrow()">{{
                    item.label
                  }}</span>
                </a>
              </li>
            }
          </ul>
        }
      </nav>

      <div class="shrink-0 border-t border-white/10 p-3">
        <div class="flex items-center gap-2.5 rounded-2xl p-1.5" [class.flex-col]="narrow()">
          <span
            class="grid size-9 shrink-0 place-items-center rounded-full bg-white/12 text-sm font-semibold uppercase shadow-[inset_0_1px_0_rgb(255_255_255/0.15)]"
            [attr.title]="email()"
            aria-hidden="true"
            >{{ initial() }}</span
          >
          <span
            class="min-w-0 flex-1 truncate text-sm text-[var(--glass-muted)]"
            [class.sr-only]="narrow()"
            data-testid="user-email"
            >{{ email() }}</span
          >
          <button
            type="button"
            class="icon-btn"
            aria-label="Sign out"
            title="Sign out"
            data-testid="sign-out"
            (click)="signOut()"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" class="size-5">
              <path [attr.d]="iconSignOut" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  `,
  styles: `
    svg[viewBox='0 0 24 24'] {
      fill: none;
      stroke: currentColor;
      stroke-width: 1.75;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .nav-link {
      display: flex;
      width: 100%;
      height: 2.75rem;
      align-items: center;
      gap: 0.75rem;
      border-radius: 0.875rem;
      padding-inline: 0.75rem;
      color: var(--glass-muted);
      font-size: 0.875rem;
      font-weight: 500;
      transition:
        background-color 200ms,
        color 200ms,
        box-shadow 200ms;
    }
    .narrow .nav-link {
      justify-content: center;
      padding-inline: 0;
    }
    .nav-link:hover {
      background: oklch(1 0 0 / 0.06);
      color: var(--glass-ink);
    }
    .nav-link.is-active {
      background: oklch(1 0 0 / 0.14);
      color: var(--glass-ink);
      box-shadow:
        inset 0 1px 0 oklch(1 0 0 / 0.18),
        0 10px 22px -14px rgb(0 0 0 / 0.7);
    }
    .icon-btn {
      display: grid;
      width: 2.25rem;
      height: 2.25rem;
      flex-shrink: 0;
      place-items: center;
      border-radius: 9999px;
      color: var(--glass-muted);
      transition:
        background-color 200ms,
        color 200ms;
    }
    .icon-btn:hover {
      background: oklch(1 0 0 / 0.1);
      color: var(--glass-ink);
    }
    .nav-link:focus-visible,
    .icon-btn:focus-visible {
      outline: 2px solid var(--qa-primary-soft);
      outline-offset: 2px;
    }
  `,
})
export class Sidebar {
  private readonly session = inject(AuthSession);
  private readonly router = inject(Router);

  readonly collapsed = input(false);
  /** Drawer mode (narrow screens): always expanded, closes itself, no collapse control. */
  readonly drawer = input(false, { transform: booleanAttribute });

  readonly toggle = output<void>();
  readonly navigated = output<void>();
  readonly dismiss = output<void>();

  protected readonly groups = NAV_GROUPS;
  protected readonly iconPanel = ICON_PANEL;
  protected readonly iconSignOut = ICON_SIGN_OUT;
  protected readonly iconClose = ICON_CLOSE;

  protected readonly narrow = computed(() => this.collapsed() && !this.drawer());
  protected readonly email = computed(() => this.session.user()?.email ?? '');
  protected readonly initial = computed(() => this.email().charAt(0));

  protected signOut(): void {
    this.session.signOut();
    void this.router.navigateByUrl(LOGIN_PATH);
  }
}
