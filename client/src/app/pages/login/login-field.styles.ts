/**
 * Filled text fields of the dark login panel. Shared by the sign-in page and the password recovery
 * view (component styles are scoped, so each component includes this string in its `styles`).
 */
export const LOGIN_FIELD_STYLES = `
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
  /* Room for the show/hide password button inside the field. */
  .filled.with-toggle {
    padding-inline-end: 3rem;
  }
`;
