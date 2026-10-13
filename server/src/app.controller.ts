import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  // Public by design (FR-10): the host's health check carries no token. The
  // `@Public()` marker arrives with the auth guard in the auth module.
  @Get('health')
  getHealth(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
