import { Controller, Get } from '@nestjs/common';
import { JsonDatabaseService } from './persistence/json-database.service';

@Controller()
export class AppController {
  constructor(private readonly database: JsonDatabaseService) {}

  @Get()
  getRoot() {
    return {
      name: 'event-processing-engine',
      status: 'ok',
    };
  }

  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      database: this.database.isReady() ? 'ok' : 'unavailable',
      timestamp: new Date().toISOString(),
    };
  }
}
