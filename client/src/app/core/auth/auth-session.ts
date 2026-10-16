import { DestroyRef, PLATFORM_ID, Service, computed, inject, signal } from '@angular/core';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { firstValueFrom, timeout } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { ApiError, CLIENT_ERROR, toApiError } from '../http/api-envelope';
import { AuthApi } from './auth-api';
import {
  Credentials,
  LoginResult,
  NewPasswordChallenge,
  Session,
  UserProfile,
  endsSession,
  isChallenge,
} from './auth.models';
import { DeepLink, LOGIN_PATH } from './deep-link';
import { DESIGN_SESSION_KEY, designSession, isDesignUser } from './design-user';
import { TokenStore } from './token-store';

/**
 * `unknown` until the first refresh answers. Guards WAIT for it instead of reading a default
 * (PRMS `readOnly = true` race, P2-3322).
 */
export type SessionStatus = 'unknown' | 'authenticated' | 'anonymous';

/** `renewed`: new token · `ended`: the server closed the session · `unavailable`: network/503, session kept. */
function isHttpUrl(value: string): boolean {
  try {
    return ['https:', 'http:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export type RefreshOutcome = 'renewed' | 'ended' | 'unavailable';

/** The app waits this long for the startup refresh before showing login (a hung API must not freeze the app). */
const STARTUP_REFRESH_TIMEOUT_MS = 8000;

/** sessionStorage flag: a sign-out could not reach the server, so the refresh cookie may still be alive. */
export const PENDING_LOGOUT_KEY = 'qa.pendingLogout';
/** Bounds for the proactive refresh timer (bad `expiresIn` must not cause a request loop). */
const MIN_REFRESH_DELAY_MS = 30_000;
const MAX_REFRESH_DELAY_MS = 12 * 3600_000;
/** Retry the proactive refresh this long after a network/503 failure. */
const REFRESH_RETRY_MS = 30_000;

/** Refresh this many seconds before the access token expires. */
const PROACTIVE_REFRESH_MARGIN_S = 60;

/** Holds the signed-in user, the session status and every auth flow. */
@Service()
export class AuthSession {
  private readonly api = inject(AuthApi);
  private readonly tokens = inject(TokenStore);
  private readonly deepLink = inject(DeepLink);
  private readonly router = inject(Router);
  private readonly config = inject(APP_CONFIG);
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly state = signal<SessionStatus>(this.isBrowser ? 'unknown' : 'anonymous');
  private readonly profile = signal<UserProfile | null>(null);
  private readonly busy = signal(false);
  private readonly challengeState = signal<{
    email: string;
    challenge: NewPasswordChallenge;
  } | null>(null);
  private readonly startupProblem = signal<ApiError | null>(null);
  /** Why the server closed the session when it was not a plain expiry (inactive user, no roles…). */
  private readonly endReason = signal<ApiError | null>(null);

  private resolveReady!: () => void;
  private readonly readyPromise = new Promise<void>((resolve) => (this.resolveReady = resolve));
  private signInAttempt: Promise<LoginResult> | null = null;
  private refreshAttempt: Promise<RefreshOutcome> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped on every local sign-out: a refresh answer from an older epoch is ignored (no resurrection). */
  private epoch = 0;
  /** TODO(api): design branch only, see `design-user.ts`. */
  private designActive = false;

  readonly status = this.state.asReadonly();
  readonly user = this.profile.asReadonly();
  readonly isSignedIn = computed(() => this.state() === 'authenticated');
  /** True while a login, new-password or SSO exchange is running. */
  readonly signingIn = this.busy.asReadonly();
  /** Set while the first login asks for a new password. */
  readonly pendingChallenge = computed(() => this.challengeState());
  /** Network or service problem on the startup refresh (not a missing session). */
  readonly startupError = this.startupProblem.asReadonly();
  /** Server message to show on the login page after an admission refusal; null for a plain expiry. */
  readonly sessionEndReason = this.endReason.asReadonly();

  constructor() {
    if (!this.isBrowser) this.resolveReady();
    inject(DestroyRef).onDestroy(() => this.cancelRefreshTimer());
  }

  /** Resolves once the status is no longer `unknown`. */
  ready(): Promise<void> {
    return this.readyPromise;
  }

  /** App start (browser only): one refresh with the cookie recovers the session after a reload. */
  async bootstrap(): Promise<void> {
    if (!this.isBrowser || this.state() !== 'unknown') return;
    if (this.hasDesignSession()) {
      this.applyDesign();
      this.resolveReady();
      return;
    }
    if (this.hasPendingLogout()) {
      // The last sign-out did not reach the server: finish it instead of reviving the session.
      await this.retryPendingLogout();
      this.clearLocal();
      this.resolveReady();
      return;
    }
    try {
      this.apply(
        await firstValueFrom(this.api.refresh().pipe(timeout(STARTUP_REFRESH_TIMEOUT_MS))),
      );
    } catch (error) {
      const apiError = toApiError(error);
      if (!endsSession(apiError)) this.startupProblem.set(apiError);
      else if (apiError.status !== 401) this.endReason.set(apiError);
      this.clearLocal();
    } finally {
      this.resolveReady();
    }
  }

  /** One attempt at a time: a second call while one runs returns the same promise. */
  signIn(credentials: Credentials): Promise<LoginResult> {
    if (this.signInAttempt) return this.signInAttempt;
    if (isDesignUser(credentials)) return Promise.resolve(this.applyDesign());
    this.busy.set(true);
    this.signInAttempt = firstValueFrom(this.api.login(credentials))
      .then((result) => {
        if (isChallenge(result)) {
          this.challengeState.set({ email: credentials.email, challenge: result });
        } else {
          this.apply(result);
        }
        return result;
      })
      .finally(() => {
        this.signInAttempt = null;
        this.busy.set(false);
      });
    return this.signInAttempt;
  }

  /** Second step of the first login. Throws `AUTH_CHALLENGE_EXPIRED` handling to the caller. */
  async completeNewPassword(newPassword: string): Promise<void> {
    const pending = this.challengeState();
    if (!pending) {
      throw new ApiError({
        status: 401,
        code: 'AUTH_CHALLENGE_EXPIRED',
        message: 'Your sign-in expired. Sign in again.',
      });
    }
    if (this.busy()) return;
    this.busy.set(true);
    try {
      this.apply(
        await firstValueFrom(
          this.api.completeNewPassword(pending.email, newPassword, pending.challenge.session),
        ),
      );
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.code === 'AUTH_CHALLENGE_EXPIRED') this.challengeState.set(null);
      throw apiError;
    } finally {
      this.busy.set(false);
    }
  }

  cancelChallenge(): void {
    this.challengeState.set(null);
  }

  /** Callback URL registered in Cognito: `<origin><ssoCallbackPath>`. */
  ssoRedirectUri(): string {
    return `${this.document.location.origin}${this.config.ssoCallbackPath}`;
  }

  /** Leaves the app for the CGIAR sign-in page; the deep link survives in sessionStorage. */
  async startSso(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const { url } = await firstValueFrom(this.api.providerUrl(this.ssoRedirectUri()));
      if (!isHttpUrl(url)) {
        throw new ApiError({
          status: 200,
          code: CLIENT_ERROR.UNEXPECTED_RESPONSE,
          message: 'The sign-in service answered with an invalid address. Please try again later.',
        });
      }
      this.document.location.assign(url);
    } finally {
      this.busy.set(false);
    }
  }

  /** Back from SSO: exchanges the one-time code for a session. */
  async completeSso(code: string): Promise<void> {
    this.busy.set(true);
    try {
      this.apply(await firstValueFrom(this.api.exchangeCode(code, this.ssoRedirectUri())));
    } finally {
      this.busy.set(false);
      this.resolveReady();
    }
  }

  /**
   * Shared refresh: concurrent callers (interceptor 401s, the timer) get ONE request.
   * Only `ended` clears the session; a network blip or 503 keeps it (the server keeps the cookies on 503).
   */
  refresh(): Promise<RefreshOutcome> {
    if (this.designActive) return Promise.resolve('renewed');
    if (this.refreshAttempt) return this.refreshAttempt;
    const epoch = this.epoch;
    this.refreshAttempt = firstValueFrom(this.api.refresh())
      .then((session): RefreshOutcome => {
        // Signed out while the request was in flight: never bring that session back.
        if (epoch !== this.epoch) return 'ended';
        this.apply(session);
        return 'renewed';
      })
      .catch((error: unknown): RefreshOutcome => {
        // A 401 or an admission refusal (403/409) means the session is over. 5xx, 429, a gateway
        // timeout or a 403 on Origin keep the user signed in: their cookie may still be valid and
        // unsaved work must not be lost.
        const apiError = toApiError(error);
        if (!endsSession(apiError)) return 'unavailable';
        if (epoch === this.epoch) {
          this.clearLocal();
          if (apiError.status !== 401) this.endReason.set(apiError);
        }
        return 'ended';
      })
      .finally(() => (this.refreshAttempt = null));
    return this.refreshAttempt;
  }

  /** The server rejected the session: sign out locally and go to login, keeping where the user was. */
  async expire(): Promise<void> {
    this.deepLink.save(this.router.url);
    this.clearLocal();
    await this.router.navigateByUrl(LOGIN_PATH);
  }

  /** Server logout (revokes and clears cookies); the local session ends even if the call fails. */
  async signOut(): Promise<void> {
    if (this.designActive) {
      this.clearLocal();
      await this.router.navigateByUrl(LOGIN_PATH);
      return;
    }
    try {
      if (this.isSignedIn()) await firstValueFrom(this.api.logout());
      this.setPendingLogout(false);
    } catch (error) {
      // The server could not revoke the cookie (offline, 5xx): remember it so a reload in this tab
      // finishes the sign-out instead of reviving the session. A 401 means it was already over.
      this.setPendingLogout(toApiError(error).status !== 401);
    } finally {
      this.clearLocal();
      await this.router.navigateByUrl(LOGIN_PATH);
    }
  }

  private apply(session: Session): void {
    if (
      !session ||
      typeof session.accessToken !== 'string' ||
      !session.accessToken ||
      !session.user
    ) {
      throw new ApiError({
        status: 200,
        code: CLIENT_ERROR.UNEXPECTED_RESPONSE,
        message: 'Something went wrong on our side. Please try again in a moment.',
      });
    }
    this.tokens.set(session.accessToken, session.expiresIn);
    this.profile.set(session.user);
    this.challengeState.set(null);
    this.startupProblem.set(null);
    this.endReason.set(null);
    this.state.set('authenticated');
    this.scheduleRefresh(session.expiresIn);
  }

  /** Signs in the hardcoded design user: no API call, no refresh timer. */
  private applyDesign(): Session {
    const session = designSession();
    this.designActive = true;
    this.setDesignSession(true);
    this.tokens.set(session.accessToken, session.expiresIn);
    this.profile.set(session.user);
    this.challengeState.set(null);
    this.startupProblem.set(null);
    this.state.set('authenticated');
    return session;
  }

  private hasDesignSession(): boolean {
    try {
      return sessionStorage.getItem(DESIGN_SESSION_KEY) === '1';
    } catch {
      return false;
    }
  }

  private setDesignSession(active: boolean): void {
    if (!this.isBrowser) return;
    try {
      if (active) sessionStorage.setItem(DESIGN_SESSION_KEY, '1');
      else sessionStorage.removeItem(DESIGN_SESSION_KEY);
    } catch {
      // Storage blocked: the design user signs in again after a reload.
    }
  }

  private clearLocal(): void {
    if (this.designActive) {
      this.designActive = false;
      this.setDesignSession(false);
    }
    this.epoch++;
    this.cancelRefreshTimer();
    this.tokens.clear();
    this.profile.set(null);
    this.challengeState.set(null);
    this.state.set('anonymous');
  }

  private scheduleRefresh(expiresInSeconds: number): void {
    const ttl = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? expiresInSeconds : 0;
    const wanted = Math.max(ttl - PROACTIVE_REFRESH_MARGIN_S, ttl / 2) * 1000;
    this.armTimer(Math.min(Math.max(wanted, MIN_REFRESH_DELAY_MS), MAX_REFRESH_DELAY_MS));
  }

  private armTimer(delayMs: number): void {
    this.cancelRefreshTimer();
    if (!this.isBrowser) return;
    this.refreshTimer = setTimeout(async () => {
      const outcome = await this.refresh();
      if (outcome === 'ended') await this.expire();
      else if (outcome === 'unavailable') this.armTimer(REFRESH_RETRY_MS);
    }, delayMs);
  }

  private hasPendingLogout(): boolean {
    try {
      return sessionStorage.getItem(PENDING_LOGOUT_KEY) === '1';
    } catch {
      return false;
    }
  }

  private setPendingLogout(pending: boolean): void {
    if (!this.isBrowser) return;
    try {
      if (pending) sessionStorage.setItem(PENDING_LOGOUT_KEY, '1');
      else sessionStorage.removeItem(PENDING_LOGOUT_KEY);
    } catch {
      // Storage blocked: nothing else we can do from the browser.
    }
  }

  private async retryPendingLogout(): Promise<void> {
    try {
      await firstValueFrom(this.api.logout().pipe(timeout(STARTUP_REFRESH_TIMEOUT_MS)));
      this.setPendingLogout(false);
    } catch (error) {
      this.setPendingLogout(toApiError(error).status !== 401);
    }
  }

  private cancelRefreshTimer(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }
}
