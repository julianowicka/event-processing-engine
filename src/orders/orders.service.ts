import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { parseJsonObject } from '../common/json.util';
import {
  EventDecisionEntity,
  OrderEntity,
  RawIncomingEventEntity,
} from '../database/entities';
import { EngineDecision, ProcessingStatus } from '../events/types/event.types';
import type {
  OrderCurrentState,
  OrderDecisionEntry,
  OrderDetailsResponse,
  OrderHistoryEntry,
  OrderPendingJob,
} from './orders.types';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(OrderEntity)
    private readonly orders: Repository<OrderEntity>,
    @InjectRepository(EventDecisionEntity)
    private readonly decisions: Repository<EventDecisionEntity>,
    @InjectRepository(RawIncomingEventEntity)
    private readonly rawEvents: Repository<RawIncomingEventEntity>,
  ) {}

  async getOrderDetails(orderId: string): Promise<OrderDetailsResponse> {
    const [currentState, auditLog] = await Promise.all([
      this.findCurrentState(orderId),
      this.readAuditLog(orderId),
    ]);

    if (!currentState && auditLog.length === 0) {
      throw new NotFoundException(`Order ${orderId} was not found`);
    }

    const [history, pendingJobs] = await Promise.all([
      Promise.resolve(this.readHistory(auditLog)),
      this.readPendingJobs(orderId),
    ]);

    return {
      orderId,
      currentState,
      history,
      rejectedEvents: auditLog.filter((entry) =>
        [
          EngineDecision.Rejected,
          EngineDecision.Duplicate,
          EngineDecision.Failed,
        ].includes(entry.decision),
      ),
      pendingJobs,
      auditLog,
    };
  }

  private async findCurrentState(
    orderId: string,
  ): Promise<OrderCurrentState | null> {
    const order = await this.orders.findOneBy({ orderId });

    if (!order) {
      return null;
    }

    return {
      orderId: order.orderId,
      status: order.status,
      amountMinor: order.amountMinor,
      currency: order.currency,
      paidAmountMinor: order.paidAmountMinor,
      refundedAmountMinor: order.refundedAmountMinor,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  private readHistory(auditLog: OrderDecisionEntry[]): OrderHistoryEntry[] {
    return auditLog
      .filter(
        (entry) =>
          (entry.decision === EngineDecision.Accepted ||
            entry.decision === EngineDecision.PartiallyApplied) &&
          entry.eventId !== null &&
          entry.type !== null &&
          entry.timestamp !== null &&
          entry.toStatus !== null,
      )
      .map(
        (entry) =>
          ({
            id: entry.id,
            eventId: entry.eventId,
            type: entry.type,
            timestamp: entry.timestamp,
            processedAt: entry.createdAt,
            fromStatus: entry.fromStatus,
            toStatus: entry.toStatus,
            changedFields: entry.changedFields,
            skippedFields: entry.skippedFields,
            decision: entry.decision,
            reasonCode: entry.reasonCode,
            createdAt: entry.createdAt,
          }) as OrderHistoryEntry,
      );
  }

  private async readAuditLog(orderId: string): Promise<OrderDecisionEntry[]> {
    const rawEvents = await this.rawEvents.find({
      where: { orderId },
      order: { id: 'ASC' },
    });

    if (rawEvents.length === 0) {
      return [];
    }

    const rawById = new Map(rawEvents.map((raw) => [raw.id, raw]));
    const decisions = await this.decisions.find({
      where: { rawIncomingEventId: In(rawEvents.map((raw) => raw.id)) },
      order: { id: 'ASC' },
    });
    return decisions.map((decision) =>
      this.mapDecision(decision, rawById.get(decision.rawIncomingEventId)!),
    );
  }

  private async readPendingJobs(orderId: string): Promise<OrderPendingJob[]> {
    const pendingEvents = await this.rawEvents.find({
      where: {
        orderId,
        processingStatus: In([
          ProcessingStatus.Pending,
          ProcessingStatus.Retry,
        ]),
      },
      order: { id: 'ASC' },
    });

    return pendingEvents.map((raw) => ({
      id: raw.id,
      rawIncomingEventId: raw.id,
      status: raw.processingStatus,
      availableAt: raw.availableAt,
      attempts: raw.attempts,
      lastErrorMessage: raw.lastErrorMessage,
      eventId: raw.eventId,
      orderId: raw.orderId,
      type: raw.type,
      timestamp: raw.eventTimestamp,
      receivedAt: raw.receivedAt,
    }));
  }

  private mapDecision(
    decision: EventDecisionEntity,
    raw: RawIncomingEventEntity,
  ): OrderDecisionEntry {
    return {
      id: decision.id,
      rawIncomingEventId: decision.rawIncomingEventId,
      eventId: raw.eventId,
      orderId: raw.orderId,
      type: raw.type,
      timestamp: raw.eventTimestamp,
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
}
