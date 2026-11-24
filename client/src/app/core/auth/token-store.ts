import { Service, signal } from '@angular/core';

/**
 * Access token kept ONLY in memory (backend contract § 8). Never write it to localStorage,
 * sessionStorage or a JS-readable cookie: a reload recovers it with the refresh cookie.
 */
@Service()
export class TokenStore {
  private readonly token = signal<string | null>(null);
  private readonly expiry = signal<number | null>(null);

  readonly accessToken = this.token.asReadonly();
  /** Epoch ms when the access token expires. */
  readonly expiresAt = this.expiry.asReadonly();

  set(accessToken: string, expiresInSeconds: number, now = Date.now()): void {
    this.token.set(accessToken);
    this.expiry.set(now + expiresInSeconds * 1000);
  }

  clear(): void {
    this.token.set(null);
    this.expiry.set(null);
  }
}
