import { Controller, Get } from '@nestjs/common';
import type { EngineStats } from './stats.types';
import { StatsService } from './stats.service';

@Controller('stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get()
  getStats(): EngineStats {
    return this.statsService.getStats();
  }
}
