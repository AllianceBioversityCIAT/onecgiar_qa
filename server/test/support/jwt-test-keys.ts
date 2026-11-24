import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { SimpleJwksCache } from 'aws-jwt-verify/jwk';

// Test-only helpers to mint real RS256 JWTs with a locally generated RSA key
// and to describe that key as a JWKS. The verifier is never mocked: tests hand
// it a `JwksCache` that serves the local key set (premise P-13), so no network
// is involved.

export interface KeyPair {
  kid: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
}

export function newKeyPair(kid: string): KeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  return { kid, privateKey, publicKey };
}

export function jwksOf(...pairs: KeyPair[]) {
  return {
    keys: pairs.map((pair) => ({
      ...pair.publicKey.export({ format: 'jwk' }),
      kid: pair.kid,
      alg: 'RS256',
      use: 'sig',
    })),
  };
}

export function b64url(value: object | Buffer): string {
  const buffer = Buffer.isBuffer(value)
    ? value
    : Buffer.from(JSON.stringify(value));
  return buffer.toString('base64url');
}

export function signJwt(
  claims: Record<string, unknown>,
  key: KeyPair,
  kid: string = key.kid,
): string {
  const signingInput = `${b64url({ alg: 'RS256', typ: 'JWT', kid })}.${b64url(claims)}`;
  const signature = sign(
    'RSA-SHA256',
    Buffer.from(signingInput),
    key.privateKey,
  );
  return `${signingInput}.${b64url(signature)}`;
}

/**
 * A JWKS cache whose "download" is served from memory for every JWKS URI. Use
 * it when the app boots (the verifier's start-up warm-up fetches the JWKS, and
 * a plain pre-loaded cache would still go to the network for that).
 */
export function localJwksCache(...pairs: KeyPair[]): SimpleJwksCache {
  const bytes = Buffer.from(JSON.stringify(jwksOf(...pairs)));
  const body = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.length,
  );
  return new SimpleJwksCache({ fetcher: { fetch: async () => body } });
}
