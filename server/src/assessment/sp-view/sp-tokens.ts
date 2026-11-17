// P2-3911: the opaque secrets of the SP view. QA signs nothing (FR-17,
// `auth/no-qa-tokens.spec.ts`): a code or a session token is 32 random bytes,
// stored only as its SHA-256, and compared in constant time.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 32 random bytes as base64url: 43 characters. */
export function newOpaqueSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** The lowercase hex SHA-256 of a UTF-8 string (64 characters). */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Constant-time equality of two strings of any length: both are hashed first,
 * so the comparison never leaks the length or a prefix of the expected value.
 */
export function secretEquals(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}
