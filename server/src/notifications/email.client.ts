import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { catalogsConfig } from '../config/catalogs.config.js';
import { notificationsConfig } from '../config/notifications.config.js';

/** Timeout of one call to the Notification Microservice. */
export const EMAIL_TIMEOUT_MS = 10_000;

/** Sender name (the service appends " No reply"); the address is the service's default (`MS_DEFAULT_EMAIL`). */
export const EMAIL_SENDER_NAME = 'One CGIAR QA Platform';

export interface EmailMessage {
  /** One recipient. */
  to: string;
  subject: string;
  /** Plain-text body (fallback for clients without HTML). */
  text: string;
  /** Full HTML document; the service inlines its CSS. */
  html: string;
}

/**
 * `queued`: the service accepted it (202; delivery is asynchronous).
 * `disabled`: `NOTIFICATION_EMAIL_ENABLED=false`, nothing sent.
 * `failed`: refused, timeout or network — logged, never thrown.
 */
export type EmailOutcome = 'queued' | 'disabled' | 'failed';

/**
 * Adapter over the One CGIAR Notification Microservice (`POST /send`,
 * multipart: `emailBody` JSON + the HTML as the `file` part), authenticated
 * with the CLARISA API key (`X-API-Key`). Email is a side effect of a change
 * that already committed, so this client NEVER throws: it reports an outcome
 * and logs only the status (never the recipient, the subject or the key).
 */
@Injectable()
export class EmailClient {
  private readonly logger = new Logger(EmailClient.name);

  constructor(
    @Inject(notificationsConfig.KEY)
    private readonly config: Pick<
      ConfigType<typeof notificationsConfig>,
      'apiUrl' | 'enabled'
    >,
    @Inject(catalogsConfig.KEY)
    private readonly keys: Pick<ConfigType<typeof catalogsConfig>, 'apiKey'>,
  ) {}

  async send(message: EmailMessage): Promise<EmailOutcome> {
    if (!this.config.enabled) {
      this.logger.log('email outcome=disabled');
      return 'disabled';
    }
    const form = new FormData();
    form.append('from', JSON.stringify({ name: EMAIL_SENDER_NAME }));
    form.append(
      'emailBody',
      JSON.stringify({
        subject: message.subject,
        to: message.to,
        message: { text: message.text },
      }),
    );
    form.append(
      'file',
      new Blob([message.html], { type: 'text/html' }),
      'email.html',
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EMAIL_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.config.apiUrl}/send`, {
        method: 'POST',
        headers: { 'x-api-key': this.keys.apiKey },
        body: form,
        signal: controller.signal,
      });
      // Drain the body so the connection is released; its content is not logged.
      await res.text().catch(() => '');
      if (res.status >= 200 && res.status < 300) {
        this.logger.log(`email outcome=queued status=${res.status}`);
        return 'queued';
      }
      this.logger.warn(`email outcome=failed status=${res.status}`);
      return 'failed';
    } catch {
      this.logger.warn(
        `email outcome=failed reason=${controller.signal.aborted ? 'timeout' : 'network'}`,
      );
      return 'failed';
    } finally {
      clearTimeout(timer);
    }
  }
}
