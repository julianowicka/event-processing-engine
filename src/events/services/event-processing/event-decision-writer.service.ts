import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import type { JsonObject } from '../../../common/json.types';
import {
  DeadLetterEventEntity,
  EngineStatsEntity,
  EventDecisionEntity,
  RawIncomingEventEntity,
} from '../../../database/entities';
import {
  EngineDecision,
  OrderStatus,
  ProcessingStatus,
  ReasonCode,
} from '../../types/event.types';

export interface FinalDecisionInput {
  manager: EntityManager;
  delivery: RawIncomingEventEntity;
  decision: EngineDecision;
  reasonCode: ReasonCode;
  reasonMessage: string;
  fromStatus?: OrderStatus | null;
  toStatus?: OrderStatus | null;
  changedFields?: JsonObject;
  skippedFields?: JsonObject;
  processingTimeMs: number;
  finalAttemptCount?: number;
}

@Injectable()
export class EventDecisionWriterService {
  async writeFinalDecision(input: FinalDecisionInput): Promise<void> {
    const createdAt = new Date().toISOString();

    await input.manager.getRepository(EventDecisionEntity).save(
      input.manager.getRepository(EventDecisionEntity).create({
        rawIncomingEventId: input.delivery.id,
        decision: input.decision,
        reasonCode: input.reasonCode,
        reasonMessage: input.reasonMessage,
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus ?? null,
        changedFieldsJson: JSON.stringify(input.changedFields ?? {}),
        skippedFieldsJson: JSON.stringify(input.skippedFields ?? {}),
        processingTimeMs: input.processingTimeMs,
        createdAt,
      }),
    );

    await input.manager.getRepository(RawIncomingEventEntity).update(
      { id: input.delivery.id },
      {
        processingStatus: ProcessingStatus.Done,
        availableAt: createdAt,
        lastErrorMessage: null,
        ...(input.finalAttemptCount === undefined
          ? {}
          : { attempts: input.finalAttemptCount }),
      },
    );

    await this.incrementStats(
      input.manager,
      input.decision,
      input.processingTimeMs,
      createdAt,
    );
  }

  async writeFailedDecision(
    manager: EntityManager,
    delivery: RawIncomingEventEntity,
    errorMessage: string,
    processingTimeMs: number,
  ): Promise<void> {
    const createdAt = new Date().toISOString();

    await manager.getRepository(DeadLetterEventEntity).save(
      manager.getRepository(DeadLetterEventEntity).create({
        rawIncomingEventId: delivery.id,
        errorMessage,
        createdAt,
      }),
    );

    await manager.getRepository(EventDecisionEntity).save(
      manager.getRepository(EventDecisionEntity).create({
        rawIncomingEventId: delivery.id,
        decision: EngineDecision.Failed,
        reasonCode: ReasonCode.ProcessingError,
        reasonMessage: errorMessage,
        fromStatus: null,
        toStatus: null,
        changedFieldsJson: '{}',
        skippedFieldsJson: '{}',
        processingTimeMs,
        createdAt,
      }),
    );

    await manager.getRepository(RawIncomingEventEntity).update(
      { id: delivery.id },
      {
        processingStatus: ProcessingStatus.DeadLettered,
        availableAt: createdAt,
        lastErrorMessage: errorMessage,
      },
    );

    await this.incrementStats(
      manager,
      EngineDecision.Failed,
      processingTimeMs,
      createdAt,
    );
  }

  async markRetryableFailure(
    manager: EntityManager,
    delivery: RawIncomingEventEntity,
    errorMessage: string,
    nextAvailableAt: string,
  ): Promise<void> {
    await manager.getRepository(RawIncomingEventEntity).update(
      { id: delivery.id },
      {
        processingStatus: ProcessingStatus.Retry,
        attempts: delivery.attempts + 1,
        availableAt: nextAvailableAt,
        lastErrorMessage: errorMessage,
      },
    );
  }

  private async incrementStats(
    manager: EntityManager,
    decision: EngineDecision,
    processingTimeMs: number,
    updatedAt: string,
  ): Promise<void> {
    const repository = manager.getRepository(EngineStatsEntity);
    const stats = await repository.findOneBy({ id: 1 });

    if (!stats) {
      throw new Error('Stats row was not initialized');
    }

    stats.processedEventsCount += 1;
    stats.totalProcessingTimeMs += processingTimeMs;
    stats.updatedAt = updatedAt;

    if (
      decision === EngineDecision.Accepted ||
      decision === EngineDecision.PartiallyApplied
    ) {
      stats.validEventsCount += 1;
    } else if (decision === EngineDecision.Duplicate) {
      stats.duplicateEventsCount += 1;
    } else if (
      decision === EngineDecision.Rejected ||
      decision === EngineDecision.Failed
    ) {
      stats.rejectedEventsCount += 1;
    }

    await repository.save(stats);
  }
}
