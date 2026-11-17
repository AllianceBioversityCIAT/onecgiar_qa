import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { DestroyRef, InjectionToken, PLATFORM_ID, Service, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom, timeout } from 'rxjs';
import { ApiEnvelope, ApiError, toApiError, unwrap } from '../http/api-envelope';
import { APP_CONFIG } from '../config/app-config';
import { SpHttp } from '../api/sp-http';
import { SP_ERROR, SpReloadReason, SpSessionData } from '../api/sp.models';

/** `starting`: trading the code · `ready`: a live session · `expired`: Reporting must load the page again · `failed`: the exchange could not be done (not the code's fault). */
export type SpSessionStatus = 'idle' | 'starting' | 'ready' | 'expired' | 'failed';

/** The message Reporting listens for (contract § 3). It carries nothing else: no data, no token. */
export const SP_RELOAD_MESSAGE_TYPE = 'qa-sp:reload-required';

const EXCHANGE_TIMEOUT_MS = 20_000;

/** The window that frames this page (Reporting), or null when the page is not in a frame. */
export const SP_PARENT_FRAME = new InjectionToken<Pick<Window, 'postMessage'> | null>('SP_PARENT_FRAME', {
  providedIn: 'root',
  factory: () => {
    const win = inject(DOCUMENT).defaultView;
    return win && win.parent && win.parent !== win ? win.parent : null;
  },
});

/**
 * The Science Program session (P2-3911, contract `docs/sp-view/reporting-integration.md` § 3).
 *
 * - In memory only: never localStorage, sessionStorage or a cookie. A reload of the iframe starts over
 *   with a new code from Reporting.
 * - The one-time code is traded in the BROWSER only (`begin` does nothing on the server): a server-side
 *   exchange would burn it.
 * - The code leaves the address bar before the exchange answers.
 * - When the code is refused, or the session later ends or runs out, the page says so and posts ONE
 *   `{ type: 'qa-sp:reload-required', reason }` to the parent window.
 */
@Service()
export class SpSession {
  private readonly http = inject(SpHttp).client;
  private readonly base = inject(APP_CONFIG).apiBaseUrl;
  private readonly router = inject(Router);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly parentFrame = inject(SP_PARENT_FRAME);

  private readonly current = signal<SpSessionData | null>(null);
  private readonly state = signal<SpSessionStatus>('idle');
  private readonly reason = signal<SpReloadReason | null>(null);
  private readonly failure = signal<ApiError | null>(null);
  /** The code of the last attempt, kept in memory only to retry an exchange that never reached the server. */
  private pendingCode: string | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;

  readonly status = this.state.asReadonly();
  readonly session = this.current.asReadonly();
  readonly expiredReason = this.reason.asReadonly();
  readonly startError = this.failure.asReadonly();
  readonly ready = computed(() => this.state() === 'ready');

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearTimer());
  }

  /**
   * Starts the session from the `code` of the iframe URL. Browser only. Without a code and without a
   * live session, the link has expired (`code_invalid`).
   */
  async begin(code: string | null): Promise<void> {
    if (!this.isBrowser) return;
    if (!code) {
      if (this.state() !== 'ready' && this.state() !== 'starting') this.expire('code_invalid');
      return;
    }
    await this.dropCodeFromUrl();
    await this.exchange(code);
  }

  /** Tries the same code again after a network or server failure (never after a refusal). */
  async retry(): Promise<void> {
    if (!this.isBrowser || this.state() !== 'failed' || !this.pendingCode) return;
    await this.exchange(this.pendingCode);
  }

  /**
   * The bearer to send, or null when there is none. A session past its `expiresAt` ends here
   * (`session_expired`), so no call leaves with a dead token.
   */
  token(): string | null {
    const live = this.current();
    if (!live) return null;
    if (Date.now() >= Date.parse(live.expiresAt)) {
      this.expire('session_expired');
      return null;
    }
    return live.accessToken;
  }

  /**
   * Ends the session: forgets it, shows the "link expired" page and tells Reporting once. Later calls
   * while already expired do nothing (no second message).
   */
  expire(reason: SpReloadReason): void {
    if (this.state() === 'expired') return;
    this.clearTimer();
    this.current.set(null);
    this.pendingCode = null;
    this.reason.set(reason);
    this.state.set('expired');
    this.notifyParent(reason);
  }

  private async exchange(code: string): Promise<void> {
    this.pendingCode = code;
    this.failure.set(null);
    this.state.set('starting');
    try {
      const data = await firstValueFrom(
        this.http
          .post<ApiEnvelope<SpSessionData>>(`${this.base}/sp-access/session`, { code })
          .pipe(timeout(EXCHANGE_TIMEOUT_MS), unwrap<SpSessionData>()),
      );
      this.pendingCode = null;
      this.current.set(data);
      this.reason.set(null);
      this.state.set('ready');
      this.scheduleExpiry(data.expiresAt);
    } catch (error) {
      const apiError = toApiError(error);
      // A used, unknown or late code (and any other 401): only a new code from Reporting helps.
      if (apiError.code === SP_ERROR.CODE_INVALID || apiError.status === 401) {
        this.expire('code_invalid');
        return;
      }
      this.failure.set(apiError);
      this.state.set('failed');
    }
  }

  /** The code works once: it leaves the address bar (and the history entry) right away. */
  private async dropCodeFromUrl(): Promise<void> {
    const tree = this.router.parseUrl(this.router.url);
    if (!('code' in tree.queryParams)) return;
    const { code: _code, ...rest } = tree.queryParams;
    tree.queryParams = rest;
    await this.router.navigateByUrl(tree, { replaceUrl: true });
  }

  private scheduleExpiry(expiresAt: string): void {
    this.clearTimer();
    const left = Date.parse(expiresAt) - Date.now();
    if (!Number.isFinite(left)) return;
    // setTimeout holds at most ~24.8 days; a session lasts 8 h.
    this.expiryTimer = setTimeout(() => this.expire('session_expired'), Math.max(0, Math.min(left, 2 ** 31 - 1)));
  }

  private clearTimer(): void {
    if (this.expiryTimer !== null) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
  }

  private notifyParent(reason: SpReloadReason): void {
    // Only in the browser and inside a frame. The message has no personal data and no token, so '*'
    // leaks nothing (Reporting checks the origin on its side).
    if (!this.isBrowser || !this.parentFrame) return;
    this.parentFrame.postMessage({ type: SP_RELOAD_MESSAGE_TYPE, reason }, '*');
  }
}
