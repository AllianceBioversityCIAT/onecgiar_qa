import {
  type ExecutionContext,
  Inject,
  Injectable,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  ThrottlerModule,
  type ThrottlerLimitDetail,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import type { RequestWithId } from '../common/request-id.js';
import { logAuthDecision } from './auth-decision.js';

/** NFR-4: 10 requests per minute per client IP, counted per route. */
export const AUTH_THROTTLE_LIMIT = 10;
export const AUTH_THROTTLE_TTL_MS = 60_000;

/**
 * The limit and its storage (per process, in memory). Nothing is limited
 * until `@AuthThrottle()` puts the guard on a route. The client IP is
 * `request.ip`, which honors `trust proxy` (set in `configureApp`, premise
 * P-16): the address the one proxy in front appended to `X-Forwarded-For`.
 */
export const AuthThrottlerModule = ThrottlerModule.forRoot({
  throttlers: [{ limit: AUTH_THROTTLE_LIMIT, ttl: AUTH_THROTTLE_TTL_MS }],
  errorMessage: 'Too many requests, try again later',
});

/**
 * The stock guard plus the decision log line (NFR-7): a guard throws before
 * any interceptor runs, so the interceptor cannot see a 429. The constructor
 * is spelled out because the test toolchain does not emit constructor
 * parameter metadata: every token is named.
 */
@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    @Inject(Reflector) reflector: Reflector,
  ) {
    super(options, storageService, reflector);
  }

  protected override async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    logAuthDecision(context.switchToHttp().getRequest<RequestWithId>(), {
      outcome: 'refused',
      status: 429,
      reason: 'rate_limited',
    });
    return super.throwThrottlingException(context, detail);
  }
}

/** Limits a route to `AUTH_THROTTLE_LIMIT` requests per `AUTH_THROTTLE_TTL_MS` per client IP. */
export const AuthThrottle = () => UseGuards(AuthThrottlerGuard);
