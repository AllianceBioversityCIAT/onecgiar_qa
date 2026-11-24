import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Public } from './auth/decorators/public.decorator.js';
import { ApiOkEnvelope } from './common/api-response.js';

export class HealthResponse {
  @ApiProperty({ type: String, enum: ['ok'], example: 'ok' })
  status!: 'ok';
}

@ApiTags('health')
@Controller()
export class AppController {
  // Public by design (FR-10): the host's health check carries no token.
  @ApiOperation({ summary: 'Liveness check (public)' })
  @ApiOkEnvelope(HealthResponse)
  @Public()
  @Get('health')
  getHealth(): HealthResponse {
    return { status: 'ok' };
  }
}
