import { Component, afterNextRender, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FieldTree, FormField, email, form, required, submit } from '@angular/forms/signals';
import { HlmButton } from '@spartan/button';
import { HlmFieldImports } from '@spartan/field';
import { HlmInput } from '@spartan/input';
import { HlmSpinner } from '@spartan/spinner';
import { AuthError, AuthProvider } from '../../auth/auth-provider';
import { AuthSession } from '../../auth/auth-session';
import { safeReturnUrl } from '../../auth/auth-guards';
import { PaletteSwitcher } from './palette-switcher';
import { DEFAULT_PALETTE, PALETTES, Palette, paletteStyle } from './palettes';
import { ResultPreview } from './result-preview';

const PALETTE_KEY = 'qa.login.palette';

@Component({
  selector: 'app-login',
  imports: [
    FormField,
    HlmButton,
    HlmFieldImports,
    HlmInput,
    HlmSpinner,
    PaletteSwitcher,
    ResultPreview,
  ],
  templateUrl: './login.html',
  styles: `
    /* Spartan tokens re-pointed to the active palette inside the dark form panel. */
    .on-dark {
      --foreground: var(--qa-on-dark);
      --muted-foreground: var(--qa-muted-on-dark);
      --input: transparent;
      --ring: var(--qa-primary-soft);
      --destructive: var(--qa-danger);
    }
    .filled {
      height: 2.875rem;
      border-radius: 0.75rem;
      border-color: transparent;
      background: var(--qa-field);
      color: var(--qa-on-dark);
      padding-inline: 0.875rem;
      box-shadow: inset 0 1px 2px rgb(0 0 0 / 0.25);
    }
    .filled[data-show-error='true'] {
      box-shadow:
        inset 0 1px 2px rgb(0 0 0 / 0.25),
        0 0 0 1.5px var(--qa-danger);
    }
    @media (prefers-reduced-motion: no-preference) {
      .drift {
        transition: translate 900ms cubic-bezier(0.22, 1, 0.36, 1);
      }
    }
  `,
})
export class LoginPage {
  private readonly session = inject(AuthSession);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly isStub = inject(AuthProvider).isStub;
  protected readonly busy = this.session.signingIn;
  protected readonly failure = signal<string | null>(null);

  protected readonly palettes = PALETTES;
  protected readonly palette = signal<Palette>(DEFAULT_PALETTE);
  protected readonly paletteVars = computed(() => paletteStyle(this.palette()));

  /** Pointer offset (-0.5..0.5) for the slow parallax of the matte background shapes. */
  protected readonly pointer = signal({ x: 0, y: 0 });

  protected readonly model = signal({ email: '', password: '' });
  protected readonly loginForm = form(this.model, (fields) => {
    required(fields.email, { message: 'Enter your email.' });
    email(fields.email, { message: 'Enter a valid email address, like name@cgiar.org.' });
    required(fields.password, { message: 'Enter your password.' });
  });

  constructor() {
    afterNextRender(() => {
      const saved = readSavedPalette();
      const match = PALETTES.find((p) => p.id === saved);
      if (match) {
        this.palette.set(match);
      }
    });
  }

  protected choosePalette(palette: Palette): void {
    this.palette.set(palette);
    try {
      localStorage.setItem(PALETTE_KEY, palette.id);
    } catch {
      // storage blocked: the choice still applies for this visit
    }
  }

  protected trackPointer(event: PointerEvent): void {
    this.pointer.set({
      x: event.clientX / window.innerWidth - 0.5,
      y: event.clientY / window.innerHeight - 0.5,
    });
  }

  protected shift(depth: number): string {
    const { x, y } = this.pointer();
    return `${(x * depth).toFixed(1)}px ${(y * depth).toFixed(1)}px`;
  }

  /** Errors show once the field was touched (blur) or a submit was attempted. */
  protected showErrors(field: FieldTree<string>): boolean {
    const state = field();
    return state.touched() && state.invalid();
  }

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy()) {
      return;
    }
    this.failure.set(null);
    await submit(this.loginForm, async () => {
      try {
        await this.session.signIn(this.model());
      } catch (error) {
        this.failure.set(failureMessage(error));
        return undefined;
      }
      const target = safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl'));
      await this.router.navigateByUrl(target);
      return undefined;
    });
  }
}

function readSavedPalette(): string | null {
  try {
    return localStorage.getItem(PALETTE_KEY);
  } catch {
    return null;
  }
}

function failureMessage(error: unknown): string {
  if (error instanceof AuthError && error.reason !== 'unavailable') {
    return error.message;
  }
  return 'We could not reach the sign-in service. Check your connection and try again.';
}
