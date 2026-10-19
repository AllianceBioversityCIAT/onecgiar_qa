import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  UnsupportedUserStateException,
  UserNotFoundException,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider';
import { cognitoAdminConfig } from '../config/cognito-admin.config.js';
import { UpstreamUnavailableError } from './cognito-auth.client.js';

/** Timeout for every Cognito admin call (NFR-3). */
export const COGNITO_ADMIN_TIMEOUT_MS = 10_000;

/** Token of the SDK client, so tests (and the module) can supply it. */
export const COGNITO_IDP_CLIENT = Symbol('COGNITO_IDP_CLIENT');

/** The one SDK client method used here; the real `CognitoIdentityProviderClient` satisfies it. */
export interface CognitoIdpSender {
  send(
    command: AdminCreateUserCommand | AdminGetUserCommand,
    options?: { abortSignal?: AbortSignal },
  ): Promise<unknown>;
}

export interface CreateCognitoUserInput {
  email: string;
  givenName: string;
  familyName: string;
}

/** `created`: the account is new and Cognito emailed the temporary password. `existing_account`: nothing was written. */
export type CreateUserOutcome = 'created' | 'existing_account';

/** `not_applicable`: the user is already confirmed (or gone), so there is nothing to resend. */
export type ResendOutcome = 'resent' | 'not_applicable';

export interface CognitoAccount {
  /** Cognito `UserStatus`, e.g. `FORCE_CHANGE_PASSWORD`, `CONFIRMED`. */
  status?: string;
}

type Operation = 'AdminGetUser' | 'AdminCreateUser';

/** An AWS error name, only if it is a bare identifier: nothing else from the error can reach a log line. */
function errorName(error: unknown): string {
  const name = error instanceof Error ? error.name : undefined;
  return name !== undefined && /^\w{1,64}$/.test(name) ? name : 'unknown';
}

/**
 * Adapter over the Cognito admin API (design § 7, DD-6): looks up, creates and
 * re-invites users of the shared pool, signed with IAM credentials. Failures
 * are either an expected outcome of the call (existing account, nothing to
 * resend) or `UpstreamUnavailableError` (503 `AUTH_SERVICE_UNAVAILABLE`, the
 * same class the login client throws). Logs the operation and the AWS error
 * name only (NFR-2).
 */
@Injectable()
export class CognitoAdminClient {
  private readonly logger = new Logger(CognitoAdminClient.name);

  constructor(
    @Inject(cognitoAdminConfig.KEY)
    private readonly config: Pick<
      ConfigType<typeof cognitoAdminConfig>,
      'userPoolId'
    >,
    @Inject(COGNITO_IDP_CLIENT) private readonly idp: CognitoIdpSender,
  ) {}

  /** `AdminGetUser`; `null` when the pool has no such user. The username is the email. */
  async getUser(email: string): Promise<CognitoAccount | null> {
    try {
      const output = (await this.call(
        new AdminGetUserCommand({
          UserPoolId: this.config.userPoolId,
          Username: email,
        }),
      )) as { UserStatus?: string };
      return { status: output.UserStatus };
    } catch (error) {
      if (error instanceof UserNotFoundException) return null;
      throw this.unavailable('AdminGetUser', error);
    }
  }

  /**
   * `AdminCreateUser` with a verified email and the given names; Cognito emails
   * the temporary password. An account that already exists is never touched
   * (`UsernameExistsException` → `existing_account`).
   */
  async createUser(input: CreateCognitoUserInput): Promise<CreateUserOutcome> {
    try {
      await this.call(
        new AdminCreateUserCommand({
          UserPoolId: this.config.userPoolId,
          Username: input.email,
          UserAttributes: [
            { Name: 'email', Value: input.email },
            { Name: 'email_verified', Value: 'true' },
            { Name: 'given_name', Value: input.givenName },
            { Name: 'family_name', Value: input.familyName },
          ],
          DesiredDeliveryMediums: ['EMAIL'],
        }),
      );
      this.logger.log('cognito_admin op=AdminCreateUser outcome=created');
      return 'created';
    } catch (error) {
      if (error instanceof UsernameExistsException) {
        this.logger.log(
          'cognito_admin op=AdminCreateUser outcome=existing_account',
        );
        return 'existing_account';
      }
      throw this.unavailable('AdminCreateUser', error);
    }
  }

  /**
   * Re-sends the invitation: `AdminCreateUser` with `MessageAction: 'RESEND'`
   * (new temporary password, new validity window). A user who is no longer in
   * the invited state (`UnsupportedUserStateException`) or no longer exists is
   * `not_applicable`.
   */
  async resendInvitation(email: string): Promise<ResendOutcome> {
    try {
      await this.call(
        new AdminCreateUserCommand({
          UserPoolId: this.config.userPoolId,
          Username: email,
          MessageAction: 'RESEND',
          DesiredDeliveryMediums: ['EMAIL'],
        }),
      );
      this.logger.log('cognito_admin op=AdminCreateUser outcome=resent');
      return 'resent';
    } catch (error) {
      if (
        error instanceof UnsupportedUserStateException ||
        error instanceof UserNotFoundException
      ) {
        this.logger.log(
          `cognito_admin op=AdminCreateUser outcome=not_applicable error=${errorName(error)}`,
        );
        return 'not_applicable';
      }
      throw this.unavailable('AdminCreateUser', error);
    }
  }

  private async call(
    command: AdminCreateUserCommand | AdminGetUserCommand,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      COGNITO_ADMIN_TIMEOUT_MS,
    );
    try {
      return await this.idp.send(command, { abortSignal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /** Throttling, 5xx, timeout, network, or a pool/IAM misconfiguration: all are "Cognito unavailable" to the caller. */
  private unavailable(
    operation: Operation,
    error: unknown,
  ): UpstreamUnavailableError {
    this.logger.warn(
      `cognito_admin op=${operation} outcome=unavailable error=${errorName(error)}`,
    );
    return new UpstreamUnavailableError();
  }
}
