// P2-3911: the Science Program view, under /sp. Every route is an SP session
// route (`@SpSession()`): the Cognito guards skip it and SpSessionGuard
// requires a live SP session.
import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses, ApiOkEnvelope } from '../../common/api-response.js';
import { SpMeModel } from './models/sp-access.model.js';
import { SpAccessService, type SpMe } from './sp-access.service.js';
import type { SpSessionPrincipal } from './sp-access.store.js';
import { CurrentSpSession, SpSession } from './sp-session.decorator.js';

@ApiTags('sp-view')
@SpSession()
@Controller('sp')
export class SpViewController {
  constructor(
    @Inject(SpAccessService) private readonly access: SpAccessService,
  ) {}

  @ApiOperation({
    summary: 'Read the SP session: user name, admin flag and programs',
  })
  @ApiOkEnvelope(SpMeModel)
  @ApiErrorResponses({
    401: ['SP_SESSION_INVALID'],
    503: ['SERVICE_UNAVAILABLE'],
  })
  @Get('me')
  me(@CurrentSpSession() session: SpSessionPrincipal): Promise<SpMe> {
    return this.access.me(session);
  }
}
