import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { notificationsConfig } from '../config/notifications.config.js';
import {
  type AccessEmailKind,
  type AccessRoleLine,
  buildAccessEmail,
  type SignInPath,
} from './access-email.js';
import { EmailClient, type EmailOutcome } from './email.client.js';

export interface AccessChange {
  kind: AccessEmailKind;
  email: string;
  firstName: string | null;
  /** The roles held after the change. */
  roles: AccessRoleLine[];
  signIn: SignInPath;
}

/**
 * Tells a person what they can do in QA after a change of their access
 * (granted, roles updated, removed) and how to sign in. Called after the
 * change committed; never throws (the email client reports, it does not fail).
 */
@Injectable()
export class AccessNotifier {
  constructor(
    @Inject(EmailClient) private readonly email: EmailClient,
    @Inject(notificationsConfig.KEY)
    private readonly config: Pick<
      ConfigType<typeof notificationsConfig>,
      'appUrl'
    >,
  ) {}

  notify(change: AccessChange): Promise<EmailOutcome> {
    return this.email.send(
      buildAccessEmail({ ...change, appUrl: this.config.appUrl }),
    );
  }
}
