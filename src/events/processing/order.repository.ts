import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import {
  OrderEntity,
  OrderFieldVersionEntity,
  ProcessedEventKeyEntity,
} from '../../database/entities';
import { OrderStatus, OrderVersionedField } from '../event.types';
import type {
  OrderRow,
  ProcessingJobRow,
  ValidOrderEvent,
} from '../event.types';
import type { NextOrderState } from './event-processing.types';

@Injectable()
export class OrderRepository {
  async createOrder(
    event: ValidOrderEvent,
    amountMinor: number | null,
    currency: string | null,
    manager: EntityManager,
  ): Promise<void> {
    const now = new Date().toISOString();

    await manager.getRepository(OrderEntity).insert({
      orderId: event.orderId,
      status: OrderStatus.Created,
      amountMinor,
      currency,
      paidAmountMinor: 0,
      refundedAmountMinor: 0,
      version: 1,
      maxAcceptedEventTimestamp: event.timestamp,
      lastAcceptedEventId: event.eventId,
      createdAt: now,
      updatedAt: now,
    });
  }

  async updateOrderState(
    event: ValidOrderEvent,
    nextState: NextOrderState,
    manager: EntityManager,
  ): Promise<void> {
    const repository = manager.getRepository(OrderEntity);
    const current = await repository.findOneByOrFail({
      orderId: event.orderId,
    });

    await repository.update(
      { orderId: event.orderId },
      {
        status: nextState.status,
        amountMinor: nextState.amountMinor,
        currency: nextState.currency,
        paidAmountMinor: nextState.paidAmountMinor,
        refundedAmountMinor: nextState.refundedAmountMinor,
        version: current.version + 1,
        maxAcceptedEventTimestamp: Math.max(
          current.maxAcceptedEventTimestamp,
          event.timestamp,
        ),
        lastAcceptedEventId: event.eventId,
        updatedAt: new Date().toISOString(),
      },
    );
  }

  async claimDeduplicationKey(
    job: ProcessingJobRow,
    event: ValidOrderEvent,
    manager: EntityManager,
  ): Promise<boolean> {
    const repository = manager.getRepository(ProcessedEventKeyEntity);
    const existing = await repository.findOneBy({ eventId: event.eventId });

    if (existing) {
      return existing.firstRawIncomingEventId === job.raw_incoming_event_id;
    }

    await repository.insert({
      eventId: event.eventId,
      firstRawIncomingEventId: job.raw_incoming_event_id,
      orderId: event.orderId,
      firstSeenAt: new Date().toISOString(),
    });
    return true;
  }

  async findOrder(
    orderId: string,
    manager: EntityManager,
  ): Promise<OrderRow | null> {
    const order = await manager.getRepository(OrderEntity).findOneBy({
      orderId,
    });

    return order ? this.toOrderRow(order) : null;
  }

  async findApplicableFields(
    orderId: string,
    event: ValidOrderEvent,
    manager: EntityManager,
  ): Promise<Set<OrderVersionedField>> {
    const versions = await manager
      .getRepository(OrderFieldVersionEntity)
      .findBy({
        orderId,
      });
    const byField = new Map(
      versions.map((version) => [
        version.fieldName,
        version.lastEventTimestamp,
      ]),
    );

    return new Set(
      Object.values(OrderVersionedField).filter((fieldName) => {
        const timestamp = byField.get(fieldName);
        return timestamp === undefined || event.timestamp > timestamp;
      }),
    );
  }

  async upsertFieldVersion(
    orderId: string,
    fieldName: OrderVersionedField,
    event: ValidOrderEvent,
    manager: EntityManager,
  ): Promise<void> {
    await manager.getRepository(OrderFieldVersionEntity).upsert(
      {
        orderId,
        fieldName,
        lastEventTimestamp: event.timestamp,
        lastEventId: event.eventId,
        updatedAt: new Date().toISOString(),
      },
      ['orderId', 'fieldName'],
    );
  }

  private toOrderRow(order: OrderEntity): OrderRow {
    return {
      order_id: order.orderId,
      status: order.status,
      amount_minor: order.amountMinor,
      currency: order.currency,
      paid_amount_minor: order.paidAmountMinor,
      refunded_amount_minor: order.refundedAmountMinor,
      version: order.version,
      max_accepted_event_timestamp: order.maxAcceptedEventTimestamp,
      last_accepted_event_id: order.lastAcceptedEventId,
      created_at: order.createdAt,
      updated_at: order.updatedAt,
    };
  }
}
