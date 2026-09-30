import { Controller, Get } from '@nestjs/common';
import type { Health } from '@qarib/shared';

@Controller('health')
export class HealthController {
  @Get()
  check(): Health {
    return { status: 'ok', service: 'api', time: new Date().toISOString() };
  }
}
