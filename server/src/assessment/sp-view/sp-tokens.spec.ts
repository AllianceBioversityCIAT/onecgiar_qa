import { newOpaqueSecret, secretEquals, sha256Hex } from './sp-tokens.js';

describe('SP tokens (P2-3911)', () => {
  it('makes 43-character base64url secrets that do not repeat', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const secret = newOpaqueSecret();
      expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
      seen.add(secret);
    }
    expect(seen.size).toBe(200);
  });

  it('hashes to the lowercase hex SHA-256', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('compares secrets of any length without throwing', () => {
    expect(secretEquals('same-value', 'same-value')).toBe(true);
    expect(secretEquals('same-value', 'same-valuE')).toBe(false);
    expect(secretEquals('', 'same-value')).toBe(false);
    expect(secretEquals('same-value-and-more', 'same-value')).toBe(false);
  });
});
