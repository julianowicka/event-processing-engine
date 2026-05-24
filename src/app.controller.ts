import { Controller, Get } from '@nestjs/common';
import { SqliteService } from './database/sqlite.service';

@Controller()
export class AppController {
  constructor(private readonly sqliteService: SqliteService) {}

  @Get('health')
  health(): { status: 'ok'; database: string; timestamp: string } {
    return {
      status: 'ok',
      database: this.sqliteService.path,
      timestamp: new Date().toISOString(),
    };
  }
}
