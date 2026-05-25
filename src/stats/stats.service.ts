import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EngineStatsEntity } from '../database/entities';
import type { EngineStats } from './stats.types';

@Injectable()
export class StatsService {
  constructor(
    @InjectRepository(EngineStatsEntity)
    private readonly stats: Repository<EngineStatsEntity>,
  ) {}

  async getStats(): Promise<EngineStats> {
    const row = await this.stats.findOneBy({ id: 1 });

    if (!row) {
      throw new Error('Stats row was not initialized');
    }

    return {
      validEventsCount: row.validEventsCount,
      rejectedEventsCount: row.rejectedEventsCount,
      duplicateEventsCount: row.duplicateEventsCount,
      averageProcessingTimeMs:
        row.processedEventsCount === 0
          ? 0
          : row.totalProcessingTimeMs / row.processedEventsCount,
    };
  }
}
