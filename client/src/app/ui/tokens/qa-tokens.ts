import {
  Component,
  ComponentRef,
  EnvironmentInjector,
  Service,
  ViewEncapsulation,
  createComponent,
  inject,
} from '@angular/core';

/**
 * Empty component whose only job is to register `qa-tokens.css` as a global stylesheet
 * (ViewEncapsulation.None). It is never attached to the DOM.
 */
@Component({
  selector: 'qa-tokens-style',
  template: '',
  styleUrl: './qa-tokens.css',
  encapsulation: ViewEncapsulation.None,
})
class QaTokensStyle {}

/**
 * Makes the `.qa-tokens` class available app-wide.
 *
 * Overlays (drawers, menus, selects, tooltips) render in the CDK overlay container at body level,
 * outside the shell host, so they do not inherit the shell's CSS variables. Every overlay panel in
 * `ui/` carries `class="qa-tokens"`, which re-declares the tokens (light + `.dark`) and the Manrope font.
 * Inject this service (or call `injectQaTokens()`) from any component that renders an overlay.
 */
@Service()
export class QaTokensLoader {
  private readonly ref: ComponentRef<QaTokensStyle> = createComponent(QaTokensStyle, {
    environmentInjector: inject(EnvironmentInjector),
  });
}

/** Ensures the global `.qa-tokens` stylesheet is registered. Call in an injection context. */
export function injectQaTokens(): void {
  inject(QaTokensLoader);
}
