import { HttpClient, HttpContext, HttpErrorResponse, HttpRequest } from '@angular/common/http';
import { DestroyRef, PLATFORM_ID, Service, computed, effect, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { AuthSession } from '../auth/auth-session';
import { toApiError } from './api-envelope';
import { QUEUE_REPLAY, SILENT_ERRORS, UNSENT_LABEL } from './request-context';
import { Toasts } from './toasts';

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
const STORAGE_KEY = 'qa.unsent.v1';

export type UnsentState = 'pending' | 'sending' | 'rejected';

/** A write the server never confirmed. Tokens are never stored: a replay goes through auth again. */
export interface UnsentItem {
  readonly id: string;
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
  readonly idempotencyKey: string;
  readonly label: string;
  /** Who started it: another user signed in on this browser never replays it. */
  readonly ownerId: number | null;
  readonly createdAt: number;
  readonly attempts: number;
  readonly state: UnsentState;
  /** Server message when it was rejected. */
  readonly error: string | null;
}

/**
 * No write is lost in silence (golden rule, Yeck 28-sep-2026): a write that could not reach the
 * server waits here for the user to pick Retry or Keep in queue; kept writes survive a reload,
 * are sent again when the browser is back online (or the user signs in again) and leave the list
 * only when the server confirms them. A server rejection is shown and never retried by itself.
 */
@Service()
export class UnsentQueue {
  private readonly http = inject(HttpClient);
  private readonly session = inject(AuthSession);
  private readonly toasts = inject(Toasts);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly stored = signal<readonly UnsentItem[]>(this.load());
  private readonly waiting = signal<readonly UnsentItem[]>([]);
  private sending = false;

  /** Writes that just failed and wait for Retry / Keep in queue. */
  readonly awaitingDecision = this.waiting.asReadonly();
  /** Kept writes of the signed-in user. */
  readonly items = computed(() => {
    const ownerId = this.session.user()?.id ?? null;
    return this.stored().filter((item) => item.ownerId === ownerId);
  });
  readonly count = computed(() => this.items().length);

  constructor() {
    if (!this.isBrowser) return;
    const onOnline = () => void this.sendPending();
    window.addEventListener('online', onOnline);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('online', onOnline));
    // App start and every new sign-in: try what was left from before.
    effect(() => {
      if (this.session.isSignedIn()) void this.sendPending();
    });
  }

  /** Called by the request-safety interceptor when a write could not reach the server. */
  offer(req: HttpRequest<unknown>): void {
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
    this.waiting.update((list) => [...list, item]);
  }

  /** Retry: send the failed writes again now; the ones that still cannot get through come back here. */
  async retryAwaiting(): Promise<void> {
    const batch = this.waiting();
    this.waiting.set([]);
    for (const item of batch) {
      const outcome = await this.send(item);
      if (outcome === 'unreachable') this.waiting.update((list) => [...list, bump(item)]);
    }
  }

  /** Keep in queue: persist them; they are sent when the connection is back. */
  keepAwaiting(): void {
    const batch = this.waiting();
    if (batch.length === 0) return;
    this.waiting.set([]);
    this.save([...this.stored(), ...batch]);
    this.toasts.info(
      batch.length === 1
        ? 'Saved in Unsent. It is sent by itself when the connection is back.'
        : `${batch.length} changes saved in Unsent. They are sent by themselves when the connection is back.`,
    );
  }

  /** Sends every pending item of the signed-in user, one at a time, oldest first. */
  async sendPending(): Promise<void> {
    if (this.sending || !this.session.isSignedIn()) return;
    this.sending = true;
    try {
      for (const item of this.items()) {
        if (item.state !== 'pending') continue;
        this.replace(item.id, { ...item, state: 'sending' });
        const outcome = await this.send(item);
        if (outcome === 'sent') this.remove(item.id);
        else if (outcome === 'unreachable') this.replace(item.id, { ...bump(item), state: 'pending' });
        else this.replace(item.id, { ...item, state: 'rejected', error: outcome.message });
        // Offline again: stop here, the next `online` event resumes.
        if (outcome === 'unreachable') break;
      }
    } finally {
      this.sending = false;
    }
  }

  dismiss(id: string): void {
    this.remove(id);
  }

  /** Sign-out: the next person on this browser must not replay someone else's writes. */
  clear(): void {
    this.waiting.set([]);
    this.save([]);
  }

  private async send(item: UnsentItem): Promise<'sent' | 'unreachable' | { message: string }> {
    try {
      await firstValueFrom(
        this.http.request(item.method, item.url, {
          body: item.body,
          headers: { [IDEMPOTENCY_HEADER]: item.idempotencyKey },
          context: new HttpContext().set(QUEUE_REPLAY, true).set(SILENT_ERRORS, true),
        }),
      );
      this.toasts.success(`Sent: ${item.label}`);
      return 'sent';
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 0) return 'unreachable';
      const message = toApiError(error).message;
      this.toasts.error(`Not sent: ${item.label}. ${message}`);
      return { message };
    }
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

function bump(item: UnsentItem): UnsentItem {
  return { ...item, attempts: item.attempts + 1 };
}

function defaultLabel(req: HttpRequest<unknown>): string {
  const path = req.url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/api\/v\d+/, '');
  return `${req.method} ${path}`;
}

export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
