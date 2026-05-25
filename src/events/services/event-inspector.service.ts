import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  isJsonObject,
  parseJsonObject,
  parseJsonValue,
} from '../../common/json.util';
import {
  EventDecisionEntity,
  RawIncomingEventEntity,
} from '../../database/entities';
import {
  EngineDecision,
  type EventDecisionDetails,
  type EventDeliveryDetails,
  type EventDetailsResponse,
  type EventHistoryDetails,
} from '../types/event.types';

@Injectable()
export class EventInspectorService {
  constructor(
    @InjectRepository(RawIncomingEventEntity)
    private readonly rawEvents: Repository<RawIncomingEventEntity>,
    @InjectRepository(EventDecisionEntity)
    private readonly decisions: Repository<EventDecisionEntity>,
  ) {}

  async getEventDetails(eventId: string): Promise<EventDetailsResponse> {
    const deliveries = await this.rawEvents.find({
      where: { eventId },
      order: { id: 'ASC' },
    });

    if (deliveries.length === 0) {
      throw new NotFoundException(`Event ${eventId} was not found`);
    }

    const rawById = new Map(
      deliveries.map((delivery) => [delivery.id, delivery]),
    );
    const decisions = (
      await this.decisions.find({
        where: {
          rawIncomingEventId: In(deliveries.map((delivery) => delivery.id)),
        },
        order: { id: 'ASC' },
      })
    ).map((decision) =>
      this.mapDecision(decision, rawById.get(decision.rawIncomingEventId)!),
    );

    return {
      eventId,
      orderIds: [
        ...new Set(
          deliveries
            .map((delivery) => delivery.orderId)
            .filter((orderId): orderId is string => orderId !== null),
        ),
      ],
      deliveries: deliveries.map((delivery) => this.mapDelivery(delivery)),
      decisions,
      history: this.readHistory(decisions),
    };
  }

  private mapDelivery(delivery: RawIncomingEventEntity): EventDeliveryDetails {
    const rawEvent = parseJsonValue(delivery.rawEventJson);

    return {
      rawIncomingEventId: delivery.id,
      eventId: delivery.eventId,
      orderId: delivery.orderId,
      type: delivery.type,
      timestamp: delivery.eventTimestamp,
      receivedAt: delivery.receivedAt,
      payload:
        isJsonObject(rawEvent) && isJsonObject(rawEvent.payload)
          ? rawEvent.payload
          : null,
      rawEvent,
      processing: {
        status: delivery.processingStatus,
        availableAt: delivery.availableAt,
        attempts: delivery.attempts,
        lastErrorMessage: delivery.lastErrorMessage,
      },
    };
  }

  private mapDecision(
    decision: EventDecisionEntity,
    delivery: RawIncomingEventEntity,
  ): EventDecisionDetails {
    return {
      id: decision.id,
      rawIncomingEventId: decision.rawIncomingEventId,
      eventId: delivery.eventId,
      orderId: delivery.orderId,
      type: delivery.type,
      timestamp: delivery.eventTimestamp,
      decision: decision.decision,
      reasonCode: decision.reasonCode,
      reasonMessage: decision.reasonMessage,
      fromStatus: decision.fromStatus,
      toStatus: decision.toStatus,
      changedFields: parseJsonObject(decision.changedFieldsJson),
      skippedFields: parseJsonObject(decision.skippedFieldsJson),
      processingTimeMs: decision.processingTimeMs,
      createdAt: decision.createdAt,
    };
  }

  private readHistory(
    decisions: EventDecisionDetails[],
  ): EventHistoryDetails[] {
    return decisions
      .filter(
        (decision) =>
          (decision.decision === EngineDecision.Accepted ||
            decision.decision === EngineDecision.PartiallyApplied) &&
          decision.orderId !== null &&
          decision.eventId !== null &&
          decision.type !== null &&
          decision.timestamp !== null &&
          decision.toStatus !== null,
      )
      .map(
        (decision) =>
          ({
            id: decision.id,
            orderId: decision.orderId,
            eventId: decision.eventId,
            type: decision.type,
            timestamp: decision.timestamp,
            processedAt: decision.createdAt,
            fromStatus: decision.fromStatus,
            toStatus: decision.toStatus,
            changedFields: decision.changedFields,
            skippedFields: decision.skippedFields,
            decision: decision.decision,
            reasonCode: decision.reasonCode,
            createdAt: decision.createdAt,
          }) as EventHistoryDetails,
      );
  }
}
