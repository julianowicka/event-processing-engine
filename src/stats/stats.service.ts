import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  DeadLetterEventEntity,
  EngineStatsEntity,
  EventProcessingJobEntity,
  RawIncomingEventEntity,
} from '../database/entities';
import { JobStatus } from '../events/event.types';
import type { EngineStats } from './stats.types';

@Injectable()
export class StatsService {
  constructor(
    @InjectRepository(EngineStatsEntity)
    private readonly stats: Repository<EngineStatsEntity>,
    @InjectRepository(RawIncomingEventEntity)
    private readonly rawEvents: Repository<RawIncomingEventEntity>,
    @InjectRepository(EventProcessingJobEntity)
    private readonly jobs: Repository<EventProcessingJobEntity>,
    @InjectRepository(DeadLetterEventEntity)
    private readonly deadLetters: Repository<DeadLetterEventEntity>,
  ) {}

  async getStats(): Promise<EngineStats> {
    const row = await this.stats.findOneBy({ id: 1 });

    if (!row) {
      throw new Error('Stats row was not initialized');
    }

    const [
      rawDeliveriesCount,
      queuedJobsCount,
      pendingEventsCount,
      deadLetterEventsCount,
    ] = await Promise.all([
      this.rawEvents.count(),
      this.jobs.count(),
      this.jobs.countBy({
        status: In([JobStatus.Pending, JobStatus.Deferred]),
      }),
      this.deadLetters.count(),
    ]);

    return {
      validEventsCount: row.validEventsCount,
      acceptedEventsCount: row.acceptedEventsCount,
      partiallyAppliedEventsCount: row.partiallyAppliedEventsCount,
      rejectedEventsCount: row.rejectedEventsCount,
      duplicateEventsCount: row.duplicateEventsCount,
      processedEventsCount: row.processedEventsCount,
      averageProcessingTimeMs:
        row.processedEventsCount === 0
          ? 0
          : row.totalProcessingTimeMs / row.processedEventsCount,
      pendingEventsCount,
      queuedJobsCount,
      rawDeliveriesCount,
      deadLetterEventsCount,
      updatedAt: row.updatedAt,
    };
  }
}
