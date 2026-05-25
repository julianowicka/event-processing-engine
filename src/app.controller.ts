import { Controller, Get } from '@nestjs/common';
import { DatabaseService } from './database/database.service';

@Controller()
export class AppController {
  constructor(private readonly databaseService: DatabaseService) {}

  @Get('health')
  health(): { status: 'ok'; database: string; timestamp: string } {
    return {
      status: 'ok',
      database: this.databaseService.path,
      timestamp: new Date().toISOString(),
    };
  }
}
