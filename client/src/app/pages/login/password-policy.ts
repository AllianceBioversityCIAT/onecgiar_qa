/**
 * The password policy of the shared Cognito user pool (read from the pool on 2026-11-12:
 * minimum 8 characters, upper case, lower case, number and symbol). Shown to the user while
 * they choose a password; Cognito stays the judge (400 `AUTH_PASSWORD_POLICY`).
 */
export interface PasswordRule {
  readonly id: string;
  readonly label: string;
  readonly test: (value: string) => boolean;
}

/** Cognito's accepted special characters. */
const SYMBOLS = /[\^$*.[\]{}()?"!@#%&/\\,><':;|_~`=+-]/;

export const PASSWORD_RULES: readonly PasswordRule[] = [
  { id: 'length', label: 'At least 8 characters', test: (v) => v.length >= 8 },
  { id: 'upper', label: 'An uppercase letter (A–Z)', test: (v) => /[A-Z]/.test(v) },
  { id: 'lower', label: 'A lowercase letter (a–z)', test: (v) => /[a-z]/.test(v) },
  { id: 'number', label: 'A number (0–9)', test: (v) => /[0-9]/.test(v) },
  { id: 'symbol', label: 'A symbol, like ! @ # $ % * ?', test: (v) => SYMBOLS.test(v) },
];

/** The message of a password that misses one or more rules. */
export const PASSWORD_RULES_MESSAGE = 'The password does not meet all the requirements below.';

export const meetsPasswordPolicy = (value: string): boolean =>
  PASSWORD_RULES.every((rule) => rule.test(value));
