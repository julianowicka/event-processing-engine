import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { parseJsonObject, parseJsonValue } from '../common/json.util';
import {
  EventDecisionEntity,
  EventProcessingJobEntity,
  OrderHistoryEntity,
  RawIncomingEventEntity,
} from '../database/entities';
import type {
  EventDecisionDetails,
  EventDeliveryDetails,
  EventDetailsResponse,
  EventHistoryDetails,
} from './event.types';

@Injectable()
export class EventReadService {
  constructor(
    @InjectRepository(RawIncomingEventEntity)
    private readonly rawEvents: Repository<RawIncomingEventEntity>,
    @InjectRepository(EventProcessingJobEntity)
    private readonly jobs: Repository<EventProcessingJobEntity>,
    @InjectRepository(EventDecisionEntity)
    private readonly decisions: Repository<EventDecisionEntity>,
    @InjectRepository(OrderHistoryEntity)
    private readonly history: Repository<OrderHistoryEntity>,
  ) {}

  async getEventDetails(eventId: string): Promise<EventDetailsResponse> {
    const [deliveries, decisions, history] = await Promise.all([
      this.readDeliveries(eventId),
      this.readDecisions(eventId),
      this.readHistory(eventId),
    ]);

    if (
      deliveries.length === 0 &&
      decisions.length === 0 &&
      history.length === 0
    ) {
      throw new NotFoundException(`Event ${eventId} was not found`);
    }

    return {
      eventId,
      orderIds: this.collectOrderIds(deliveries, decisions, history),
      deliveries,
      decisions,
      history,
    };
  }

  private async readDeliveries(
    eventId: string,
  ): Promise<EventDeliveryDetails[]> {
    const raws = await this.rawEvents.find({
      where: { eventId },
      order: { id: 'ASC' },
    });

    if (raws.length === 0) {
      return [];
    }

    const jobs = await this.jobs.findBy({
      rawIncomingEventId: In(raws.map((raw) => raw.id)),
    });
    const jobsByDelivery = new Map(
      jobs.map((job) => [job.rawIncomingEventId, job]),
    );
    const decisionIds = jobs
      .map((job) => job.lastDecisionId)
      .filter((id): id is number => id !== null);
    const decisions =
      decisionIds.length === 0
        ? []
        : await this.decisions.findBy({ id: In(decisionIds) });
    const decisionsById = new Map(
      decisions.map((decision) => [decision.id, decision]),
    );

    return raws.map((raw) => {
      const job = jobsByDelivery.get(raw.id);
      const decision = job?.lastDecisionId
        ? decisionsById.get(job.lastDecisionId)
        : undefined;

      return {
        rawIncomingEventId: raw.id,
        eventId: raw.eventId,
        orderId: raw.orderId,
        type: raw.type,
        timestamp: raw.eventTimestamp,
        receivedAt: raw.receivedAt,
        payload:
          raw.payloadJson === null ? null : parseJsonObject(raw.payloadJson),
        rawEvent: parseJsonValue(raw.rawEventJson),
        processingJob: job
          ? {
              id: job.id,
              status: job.status,
              availableAt: job.availableAt,
              attempts: job.attempts,
              lastReasonCode: job.lastReasonCode,
              createdAt: job.createdAt,
              updatedAt: job.updatedAt,
              latestDecision: decision ? this.mapDecision(decision) : null,
            }
          : null,
      };
    });
  }

  private async readDecisions(
    eventId: string,
  ): Promise<EventDecisionDetails[]> {
    const decisions = await this.decisions.find({
      where: { eventId },
      order: { id: 'ASC' },
    });
    return decisions.map((decision) => this.mapDecision(decision));
  }

  private async readHistory(eventId: string): Promise<EventHistoryDetails[]> {
    const history = await this.history.find({
      where: { eventId },
      order: { id: 'ASC' },
    });

    return history.map((entry) => ({
      id: entry.id,
      orderId: entry.orderId,
      eventId: entry.eventId,
      type: entry.eventType,
      timestamp: entry.eventTimestamp,
      processedAt: entry.processedAt,
      fromStatus: entry.fromStatus,
      toStatus: entry.toStatus,
      changedFields: parseJsonObject(entry.changedFieldsJson),
      skippedFields: parseJsonObject(entry.skippedFieldsJson),
      decision: entry.decision,
      reasonCode: entry.reasonCode,
      createdAt: entry.createdAt,
    }));
  }

  private mapDecision(decision: EventDecisionEntity): EventDecisionDetails {
    return {
      id: decision.id,
      rawIncomingEventId: decision.rawIncomingEventId,
      processingJobId: decision.eventProcessingJobId,
      eventId: decision.eventId,
      orderId: decision.orderId,
      type: decision.type,
      timestamp: decision.timestamp,
      decision: decision.decision,
      reasonCode: decision.reasonCode,
      reasonMessage: decision.reasonMessage,
      details: parseJsonObject(decision.detailsJson),
      processingTimeMs: decision.processingTimeMs,
      createdAt: decision.createdAt,
    };
  }

  private collectOrderIds(
    deliveries: EventDeliveryDetails[],
    decisions: EventDecisionDetails[],
    history: EventHistoryDetails[],
  ): string[] {
    return [
      ...new Set(
        [
          ...deliveries.map((delivery) => delivery.orderId),
          ...decisions.map((decision) => decision.orderId),
          ...history.map((entry) => entry.orderId),
        ].filter((orderId): orderId is string => Boolean(orderId)),
      ),
    ];
  }
}
