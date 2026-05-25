import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  EngineStatsEntity,
  RawIncomingEventEntity,
} from '../database/entities';
import { ProcessingStatus } from '../events/types/event.types';
import type { EngineStats } from './stats.types';

@Injectable()
export class StatsService {
  constructor(
    @InjectRepository(EngineStatsEntity)
    private readonly stats: Repository<EngineStatsEntity>,
    @InjectRepository(RawIncomingEventEntity)
    private readonly rawEvents: Repository<RawIncomingEventEntity>,
  ) {}

  async getStats(): Promise<EngineStats> {
    const row = await this.stats.findOneBy({ id: 1 });

    if (!row) {
      throw new Error('Stats row was not initialized');
    }

    const [rawDeliveriesCount, pendingEventsCount] = await Promise.all([
      this.rawEvents.count(),
      this.rawEvents.countBy({
        processingStatus: In([
          ProcessingStatus.Pending,
          ProcessingStatus.Retry,
        ]),
      }),
    ]);

    return {
      validEventsCount: row.validEventsCount,
      rejectedEventsCount: row.rejectedEventsCount,
      duplicateEventsCount: row.duplicateEventsCount,
      processedEventsCount: row.processedEventsCount,
      averageProcessingTimeMs:
        row.processedEventsCount === 0
          ? 0
          : row.totalProcessingTimeMs / row.processedEventsCount,
      pendingEventsCount,
      rawDeliveriesCount,
      updatedAt: row.updatedAt,
    };
  }
}
