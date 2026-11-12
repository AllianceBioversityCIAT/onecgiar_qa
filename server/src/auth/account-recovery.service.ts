import { Inject, Injectable, Logger } from '@nestjs/common';
import { UsersRepository } from '../users/users.repository.js';
import { CognitoAdminClient } from './cognito-admin.client.js';
import { CognitoAuthClient } from './cognito-auth.client.js';

/** What happened, for the decision log only: the client always gets the same answer. */
export type RecoveryOutcome =
  'code_sent' | 'invitation_resent' | 'not_applicable';

/**
 * Self-service password recovery for custom accounts. Cognito emails the
 * verification code (`ForgotPassword`). When Cognito refuses because the
 * account never set a password (`FORCE_CHANGE_PASSWORD`, an expired or lost
 * temporary password), an active custom user QA knows gets a fresh temporary
 * password instead (`AdminCreateUser RESEND`), so nobody is stuck waiting for
 * an admin. The answer to the client never depends on any of this.
 */
@Injectable()
export class AccountRecoveryService {
  private readonly logger = new Logger(AccountRecoveryService.name);

  constructor(
    @Inject(CognitoAuthClient) private readonly auth: CognitoAuthClient,
    @Inject(CognitoAdminClient) private readonly admin: CognitoAdminClient,
    @Inject(UsersRepository) private readonly users: UsersRepository,
  ) {}

  /** Throws only `UpstreamUnavailableError` (503) from the `ForgotPassword` call itself. */
  async forgotPassword(email: string): Promise<RecoveryOutcome> {
    const result = await this.auth.forgotPassword(email);
    if (result.kind === 'sent') return 'code_sent';
    try {
      return await this.resendTemporaryPassword(email);
    } catch {
      // The fallback is a courtesy: its failure must not change the answer.
      this.logger.warn('account_recovery op=resend outcome=unavailable');
      return 'not_applicable';
    }
  }

  private async resendTemporaryPassword(
    email: string,
  ): Promise<RecoveryOutcome> {
    const user = await this.users.findByEmail(email);
    if (!user || !user.isActive || user.authSource !== 'custom') {
      return 'not_applicable';
    }
    const account = await this.admin.getUser(user.email);
    if (account?.status !== 'FORCE_CHANGE_PASSWORD') return 'not_applicable';
    const outcome = await this.admin.resendInvitation(user.email);
    return outcome === 'resent' ? 'invitation_resent' : 'not_applicable';
  }
}
