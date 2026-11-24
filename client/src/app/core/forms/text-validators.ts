import { SchemaPath, required, validate } from '@angular/forms/signals';

interface TextRuleConfig {
  message: string;
  when?: () => boolean;
}

/**
 * `required` for text the user types: only spaces counts as empty. Every save trims what it sends,
 * so "   " passed `required` and reached the server as an empty name. Keeps `required` underneath
 * so the field still reports itself as required (aria-required, asterisk).
 */
export function requiredText(path: SchemaPath<string>, config: TextRuleConfig): void {
  required(path, config);
  validate(path, ({ value }) => {
    if (config.when && !config.when()) return undefined;
    const text = value();
    return text !== '' && !text.trim() ? { kind: 'required', message: config.message } : undefined;
  });
}

/**
 * `email` that ignores spaces around the address (a pasted " name@cgiar.org "), the same way the
 * request trims it before sending.
 */
export function emailText(path: SchemaPath<string>, config: TextRuleConfig): void {
  validate(path, ({ value }) => {
    if (config.when && !config.when()) return undefined;
    const text = value().trim();
    return text && !EMAIL.test(text) ? { kind: 'email', message: config.message } : undefined;
  });
}

/** Same pattern Angular's `email` validator uses (forms/signals). */
const EMAIL =
  /^(?=.{1,254}$)(?=.{1,64}@)[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
