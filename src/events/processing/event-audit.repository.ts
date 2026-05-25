import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import type { JsonObject } from '../../common/json.types';
import {
  DeadLetterEventEntity,
  EngineStatsEntity,
  EventDecisionEntity,
  OrderHistoryEntity,
} from '../../database/entities';
import { verboseLog } from '../event-verbose-logger';
import { EngineDecision, ReasonCode } from '../event.types';
import type {
  OrderHistoryDecision,
  OrderStatus,
  ProcessingJobRow,
  ValidOrderEvent,
} from '../event.types';
import type { DecisionInput, DecisionResult } from './event-processing.types';

@Injectable()
export class EventAuditRepository {
  private readonly logger = new Logger(EventAuditRepository.name);

  async writeDecision(
    input: DecisionInput,
    manager: EntityManager,
  ): Promise<DecisionResult> {
    const repository = manager.getRepository(EventDecisionEntity);
    const decision = await repository.save(
      repository.create({
        rawIncomingEventId: input.job.raw_incoming_event_id,
        eventProcessingJobId: input.job.job_id,
        eventId: input.event.eventId ?? input.job.event_id,
        orderId: input.event.orderId ?? input.job.order_id,
        type: input.event.type ?? input.job.type,
        timestamp: input.event.timestamp ?? input.job.event_timestamp,
        decision: input.decision,
        reasonCode: input.reasonCode,
        reasonMessage: input.reasonMessage,
        detailsJson: JSON.stringify(input.details ?? {}),
        processingTimeMs: input.processingTimeMs,
        createdAt: new Date().toISOString(),
      }),
    );

    verboseLog(this.logger, 'decision written', {
      decisionId: decision.id,
      jobId: input.job.job_id,
      rawIncomingEventId: input.job.raw_incoming_event_id,
      eventId: decision.eventId,
      orderId: decision.orderId,
      type: decision.type,
      decision: input.decision,
      reasonCode: input.reasonCode,
      reasonMessage: input.reasonMessage,
      processingTimeMs: input.processingTimeMs,
      details: input.details ?? {},
    });

    return { decisionId: decision.id };
  }

  async updateFinalStats(
    decision: EngineDecision,
    processingTimeMs: number,
    manager: EntityManager,
  ): Promise<void> {
    const repository = manager.getRepository(EngineStatsEntity);
    const stats = await repository.findOneByOrFail({ id: 1 });
    const acceptedIncrement = decision === EngineDecision.Accepted ? 1 : 0;
    const partialIncrement =
      decision === EngineDecision.PartiallyApplied ? 1 : 0;
    const rejectedIncrement =
      decision === EngineDecision.Rejected || decision === EngineDecision.Failed
        ? 1
        : 0;
    const duplicateIncrement = decision === EngineDecision.Duplicate ? 1 : 0;

    await repository.update(
      { id: 1 },
      {
        validEventsCount:
          stats.validEventsCount + acceptedIncrement + partialIncrement,
        acceptedEventsCount: stats.acceptedEventsCount + acceptedIncrement,
        partiallyAppliedEventsCount:
          stats.partiallyAppliedEventsCount + partialIncrement,
        rejectedEventsCount: stats.rejectedEventsCount + rejectedIncrement,
        duplicateEventsCount: stats.duplicateEventsCount + duplicateIncrement,
        processedEventsCount: stats.processedEventsCount + 1,
        totalProcessingTimeMs: stats.totalProcessingTimeMs + processingTimeMs,
        updatedAt: new Date().toISOString(),
      },
    );
  }

  async writeHistory(
    event: ValidOrderEvent,
    fromStatus: OrderStatus | null,
    toStatus: OrderStatus,
    changedFields: JsonObject,
    skippedFields: JsonObject,
    decision: OrderHistoryDecision,
    reasonCode: ReasonCode,
    manager: EntityManager,
  ): Promise<void> {
    const now = new Date().toISOString();

    await manager.getRepository(OrderHistoryEntity).insert({
      orderId: event.orderId,
      eventId: event.eventId,
      eventType: event.type,
      eventTimestamp: event.timestamp,
      processedAt: now,
      fromStatus,
      toStatus,
      changedFieldsJson: JSON.stringify(changedFields),
      skippedFieldsJson: JSON.stringify(skippedFields),
      decision,
      reasonCode,
      createdAt: now,
    });
  }

  async insertDeadLetterEvent(
    job: ProcessingJobRow,
    errorMessage: string,
    attempts: number,
    manager: EntityManager,
  ): Promise<void> {
    await manager.getRepository(DeadLetterEventEntity).insert({
      eventProcessingJobId: job.job_id,
      rawIncomingEventId: job.raw_incoming_event_id,
      eventId: job.event_id,
      orderId: job.order_id,
      type: job.type,
      timestamp: job.event_timestamp,
      rawEventJson: job.raw_event_json,
      reasonCode: ReasonCode.ProcessingError,
      errorMessage,
      attempts,
      createdAt: new Date().toISOString(),
    });
  }
}
