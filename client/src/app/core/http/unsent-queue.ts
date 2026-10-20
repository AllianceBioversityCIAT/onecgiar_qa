import { HttpClient, HttpContext, HttpErrorResponse, HttpRequest } from '@angular/common/http';
import { DestroyRef, PLATFORM_ID, Service, computed, effect, inject, signal, untracked } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { AuthSession } from '../auth/auth-session';
import { toApiError } from './api-envelope';
import { QUEUE_REPLAY, SILENT_ERRORS, UNSENT_LABEL } from './request-context';
import { Toasts } from './toasts';

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
const STORAGE_KEY = 'qa.unsent.v1';
/** While something waits and the browser says it is online, try again this often. */
const RETRY_EVERY_MS = 60_000;

export type UnsentState = 'pending' | 'sending' | 'rejected';

/** A write the server never confirmed. Tokens are never stored: a replay goes through auth again. */
export interface UnsentItem {
  readonly id: string;
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
  readonly idempotencyKey: string;
  readonly label: string;
  /** Who started it: another user signed in on this browser never sees or replays it. */
  readonly ownerId: number | null;
  readonly createdAt: number;
  readonly attempts: number;
  readonly state: UnsentState;
  /** Server message when it was rejected. */
  readonly error: string | null;
}

/** No answer, or a gateway / server that is not up (it may come back): try again later. */
export function isTransientStatus(status: number): boolean {
  return status === 0 || status === 502 || status === 503 || status === 504;
}

/** Same method + URL + body = the same user action. Bodies that cannot be compared never match. */
export function actionSignature(method: string, url: string, body: unknown): string | null {
  if (body instanceof FormData || body instanceof Blob || body instanceof ArrayBuffer) return null;
  try {
    return `${method} ${url} ${JSON.stringify(body ?? null)}`;
  } catch {
    return null;
  }
}

/**
 * No write is lost in silence (golden rule, Yeck 28-sep-2026). A write that could not reach the
 * server is stored at once (it survives a reload even before the user decides) and the user picks
 * Retry or Keep in queue. Stored writes are sent again when the browser is back online, on sign-in,
 * every minute while online, or on "Send now", and leave the list only when the server confirms.
 * A real rejection is shown and never retried by itself.
 */
@Service()
export class UnsentQueue {
  private readonly http = inject(HttpClient);
  private readonly session = inject(AuthSession);
  private readonly toasts = inject(Toasts);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly stored = signal<readonly UnsentItem[]>(this.load());
  /** Ids that just failed and wait for the Retry / Keep in queue answer. */
  private readonly undecided = signal<readonly string[]>([]);
  private sending = false;

  /** Writes of the signed-in user. */
  readonly items = computed(() => {
    const ownerId = this.session.user()?.id ?? null;
    return this.stored().filter((item) => item.ownerId === ownerId);
  });
  readonly count = computed(() => this.items().length);
  readonly awaitingDecision = computed(() => {
    const ids = new Set(this.undecided());
    return this.items().filter((item) => ids.has(item.id));
  });

  constructor() {
    if (!this.isBrowser) return;
    const resume = () => void this.sendPending();
    window.addEventListener('online', resume);
    const timer = setInterval(() => {
      if (navigator.onLine && this.count() > 0) resume();
    }, RETRY_EVERY_MS);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', resume);
      clearInterval(timer);
    });
    // App start and every new sign-in. Untracked: sending rewrites the list, and the effect must not
    // re-run on that (it would resend in a loop).
    effect(() => {
      if (this.session.isSignedIn()) untracked(resume);
    });
  }

  /** Called by the request-safety interceptor when a write could not reach the server. */
  offer(req: HttpRequest<unknown>): void {
    const signature = actionSignature(req.method, req.urlWithParams, req.body);
    const same = this.findPending(signature);
    if (same) {
      // The same action is already stored: never store it twice, just ask again.
      this.undecided.update((ids) => (ids.includes(same.id) ? ids : [...ids, same.id]));
      return;
    }
    const item: UnsentItem = {
      id: newId(),
      method: req.method,
      url: req.urlWithParams,
      body: req.body,
      idempotencyKey: req.headers.get(IDEMPOTENCY_HEADER) ?? newId(),
      label: req.context.get(UNSENT_LABEL) ?? defaultLabel(req),
      ownerId: this.session.user()?.id ?? null,
      createdAt: Date.now(),
      attempts: 1,
      state: 'pending',
      error: null,
    };
    this.save([...this.stored(), item]);
    this.undecided.update((ids) => [...ids, item.id]);
  }

  /**
   * A new write identical to a stored one (the user pressed Save again) reuses its key, so the
   * server can tell it is the same action; once it succeeds the stored copy is dropped.
   */
  keyFor(signature: string | null): string | null {
    return this.findPending(signature)?.idempotencyKey ?? null;
  }

  confirmedElsewhere(signature: string | null): void {
    const same = this.findPending(signature);
    if (same) this.remove(same.id);
  }

  /** Retry: send the undecided writes now; the ones that still cannot get through ask again. */
  async retryAwaiting(): Promise<void> {
    const batch = this.awaitingDecision();
    this.undecided.set([]);
    for (const item of batch) {
      const outcome = await this.sendOne(item);
      if (outcome === 'unreachable') this.undecided.update((ids) => [...ids, item.id]);
    }
  }

  /** Keep in queue: they are already stored; just close the question. */
  keepAwaiting(): void {
    const n = this.undecided().length;
    if (n === 0) return;
    this.undecided.set([]);
    this.toasts.info(
      n === 1
        ? 'Saved in Unsent. It is sent by itself when the connection is back.'
        : `${n} changes saved in Unsent. They are sent by themselves when the connection is back.`,
    );
  }

  /** Sends every pending, decided item of the signed-in user, one at a time, oldest first. */
  async sendPending(): Promise<void> {
    if (this.sending || !this.session.isSignedIn()) return;
    this.sending = true;
    try {
      const undecided = new Set(this.undecided());
      for (const item of this.items()) {
        if (item.state !== 'pending' || undecided.has(item.id)) continue;
        // Offline again: stop here, the next `online` event or tick resumes.
        if ((await this.sendOne(item)) === 'unreachable') break;
      }
    } finally {
      this.sending = false;
    }
  }

  /** "Try again" on a rejected item: back to pending, sent with the rest. */
  retryRejected(id: string): void {
    const item = this.stored().find((i) => i.id === id);
    if (!item || item.state !== 'rejected') return;
    this.replace(id, { ...item, state: 'pending', error: null });
    void this.sendPending();
  }

  dismiss(id: string): void {
    this.undecided.update((ids) => ids.filter((i) => i !== id));
    this.remove(id);
  }

  /** Discards the signed-in user's writes (sign-out after they agreed). Others stay untouched. */
  clearMine(): void {
    const mine = new Set(this.items().map((item) => item.id));
    this.undecided.set([]);
    this.save(this.stored().filter((item) => !mine.has(item.id)));
  }

  private async sendOne(item: UnsentItem): Promise<'sent' | 'unreachable' | 'rejected'> {
    this.replace(item.id, { ...item, state: 'sending' });
    try {
      await firstValueFrom(
        this.http.request(item.method, item.url, {
          body: item.body,
          headers: { [IDEMPOTENCY_HEADER]: item.idempotencyKey },
          context: new HttpContext().set(QUEUE_REPLAY, true).set(SILENT_ERRORS, true),
        }),
      );
      this.remove(item.id);
      this.toasts.success(`Sent: ${item.label}`);
      return 'sent';
    } catch (error) {
      const status = error instanceof HttpErrorResponse ? error.status : -1;
      // 429 = the server asked to slow down: wait, it is not a "no".
      if (isTransientStatus(status) || status === 429 || (status === 401 && this.session.isSignedIn())) {
        this.replace(item.id, { ...item, state: 'pending', attempts: item.attempts + 1 });
        return 'unreachable';
      }
      const message = toApiError(error).message;
      this.replace(item.id, { ...item, state: 'rejected', error: message });
      this.toasts.error(`Not sent: ${item.label}. ${message}`);
      return 'rejected';
    }
  }

  private findPending(signature: string | null): UnsentItem | undefined {
    if (!signature) return undefined;
    return this.items().find(
      (item) => item.state !== 'rejected' && actionSignature(item.method, item.url, item.body) === signature,
    );
  }

  private replace(id: string, next: UnsentItem): void {
    this.save(this.stored().map((item) => (item.id === id ? next : item)));
  }

  private remove(id: string): void {
    this.save(this.stored().filter((item) => item.id !== id));
  }

  private save(items: readonly UnsentItem[]): void {
    this.stored.set(items);
    if (!this.isBrowser) return;
    try {
      if (items.length === 0) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Storage full or blocked: the list still lives in memory for this tab.
    }
  }

  private load(): readonly UnsentItem[] {
    if (!this.isBrowser) return [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      // A tab closed mid-send left it as `sending`: it was never confirmed, so it is pending again.
      return (parsed as UnsentItem[]).map((item) => (item.state === 'sending' ? { ...item, state: 'pending' } : item));
    } catch {
      return [];
    }
  }
}

function defaultLabel(req: HttpRequest<unknown>): string {
  const path = req.url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/api\/v\d+/, '');
  return `${req.method} ${path}`;
}

export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
