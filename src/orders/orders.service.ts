import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { parseJsonObject } from '../common/json.util';
import {
  EventDecisionEntity,
  EventProcessingJobEntity,
  OrderEntity,
  OrderHistoryEntity,
  RawIncomingEventEntity,
} from '../database/entities';
import { EngineDecision, JobStatus } from '../events/event.types';
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
    @InjectRepository(OrderHistoryEntity)
    private readonly history: Repository<OrderHistoryEntity>,
    @InjectRepository(EventDecisionEntity)
    private readonly decisions: Repository<EventDecisionEntity>,
    @InjectRepository(RawIncomingEventEntity)
    private readonly rawEvents: Repository<RawIncomingEventEntity>,
    @InjectRepository(EventProcessingJobEntity)
    private readonly jobs: Repository<EventProcessingJobEntity>,
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
      this.readHistory(orderId),
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
      version: order.version,
      maxAcceptedEventTimestamp: order.maxAcceptedEventTimestamp,
      lastAcceptedEventId: order.lastAcceptedEventId,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  private async readHistory(orderId: string): Promise<OrderHistoryEntry[]> {
    const history = await this.history.find({
      where: { orderId },
      order: { id: 'ASC' },
    });

    return history.map((entry) => ({
      id: entry.id,
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

  private async readAuditLog(orderId: string): Promise<OrderDecisionEntry[]> {
    const decisions = await this.decisions.find({
      where: { orderId },
      order: { id: 'ASC' },
    });
    return decisions.map((decision) => this.mapDecision(decision));
  }

  private async readPendingJobs(orderId: string): Promise<OrderPendingJob[]> {
    const rawEvents = await this.rawEvents.find({
      where: { orderId },
      select: {
        id: true,
        eventId: true,
        orderId: true,
        type: true,
        eventTimestamp: true,
      },
    });

    if (rawEvents.length === 0) {
      return [];
    }

    const rawById = new Map(rawEvents.map((raw) => [raw.id, raw]));
    const jobs = await this.jobs.find({
      where: {
        rawIncomingEventId: In(rawEvents.map((raw) => raw.id)),
        status: In([JobStatus.Pending, JobStatus.Deferred]),
      },
      order: { id: 'ASC' },
    });
    const decisionIds = jobs
      .map((job) => job.lastDecisionId)
      .filter((id): id is number => id !== null);
    const decisions =
      decisionIds.length === 0
        ? []
        : await this.decisions.findBy({ id: In(decisionIds) });
    const decisionById = new Map(
      decisions.map((decision) => [decision.id, decision]),
    );

    return jobs.map((job) => {
      const raw = rawById.get(job.rawIncomingEventId)!;
      const decision = job.lastDecisionId
        ? decisionById.get(job.lastDecisionId)
        : undefined;

      return {
        id: job.id,
        rawIncomingEventId: job.rawIncomingEventId,
        status: job.status,
        availableAt: job.availableAt,
        attempts: job.attempts,
        lastReasonCode: job.lastReasonCode,
        eventId: raw.eventId,
        orderId: raw.orderId,
        type: raw.type,
        timestamp: raw.eventTimestamp,
        latestDecision: decision ? this.mapDecision(decision) : null,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      };
    });
  }

  private mapDecision(decision: EventDecisionEntity): OrderDecisionEntry {
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
}
