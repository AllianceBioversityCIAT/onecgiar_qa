// P2-3911: the two public entry points of the SP view (contract § 2, § 3).
import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AuthThrottle } from '../../auth/auth-throttle.js';
import { Public } from '../../auth/decorators/public.decorator.js';
import { ApiErrorResponses, ApiOkEnvelope } from '../../common/api-response.js';
import { SP_ACCESS_KEY_SCHEME } from '../../common/openapi.js';
import { requestIdOf, type RequestWithId } from '../../common/request-id.js';
import { ExchangeSpCodeBody, IssueSpCodeBody } from './dto/sp-access.body.js';
import { IssuedSpCodeModel, SpSessionModel } from './models/sp-access.model.js';
import {
  SpAccessService,
  type IssuedSpCode,
  type SpSessionAnswer,
} from './sp-access.service.js';
import { SpApiKeyGuard } from './sp-api-key.guard.js';

@ApiTags('sp-access')
@Public()
@Controller('sp-access')
export class SpAccessController {
  constructor(
    @Inject(SpAccessService) private readonly service: SpAccessService,
  ) {}

  @ApiOperation({
    summary: 'Issue a one-time SP link code (Reporting back only)',
    description:
      'Server-to-server: the Reporting back vouches for a user (email, name, program, admin flag) with the `x-api-key` header. Answers an opaque code that works once and lasts 60 s; QA stores only its SHA-256. Ask for a new code every time the iframe loads.',
  })
  @ApiSecurity(SP_ACCESS_KEY_SCHEME)
  @ApiOkEnvelope(IssuedSpCodeModel, { status: 201 })
  @ApiErrorResponses({
    400: ['VALIDATION_FAILED', 'MALFORMED_JSON', 'SP_PROGRAM_UNKNOWN'],
    401: ['SP_ACCESS_KEY_INVALID'],
    413: ['PAYLOAD_TOO_LARGE'],
    503: ['SP_ACCESS_DISABLED', 'SERVICE_UNAVAILABLE'],
  })
  @UseGuards(SpApiKeyGuard)
  @HttpCode(201)
  @Post('codes')
  issue(
    @Req() request: RequestWithId,
    @Body() body: IssueSpCodeBody,
  ): Promise<IssuedSpCode> {
    return this.service.issueCode(body, requestIdOf(request));
  }

  @ApiOperation({
    summary: 'Trade a one-time code for an SP session',
    description:
      "Called by the QA page in the iframe, in the browser. A code works once: unknown, used and expired codes all answer the same 401 `SP_CODE_INVALID`. The session lasts 8 h and covers the code's program (an admin session covers every program). 10 requests per minute per IP.",
  })
  @ApiOkEnvelope(SpSessionModel)
  @ApiErrorResponses({
    400: ['VALIDATION_FAILED', 'MALFORMED_JSON'],
    401: ['SP_CODE_INVALID'],
    413: ['PAYLOAD_TOO_LARGE'],
    429: ['TOO_MANY_REQUESTS'],
    503: ['SERVICE_UNAVAILABLE'],
  })
  @AuthThrottle()
  @HttpCode(200)
  @Post('session')
  exchange(
    @Req() request: RequestWithId,
    @Body() body: ExchangeSpCodeBody,
  ): Promise<SpSessionAnswer> {
    return this.service.exchange(body.code, requestIdOf(request));
  }
}
