import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { OrderFieldVersionEntity } from '../../../database/entities';
import { OrderVersionedField } from '../../types/event.types';
import type { OrderEventHandlingContext } from './handlers/order-event-handler';

@Injectable()
export class OrderFieldVersionService {
  async canApplyStatus(context: OrderEventHandlingContext): Promise<boolean> {
    return this.canApplyField(
      context.manager,
      context.event.orderId,
      OrderVersionedField.Status,
      context.event.timestamp,
    );
  }

  async canApplyField(
    manager: EntityManager,
    orderId: string,
    fieldName: OrderVersionedField,
    timestamp: number,
  ): Promise<boolean> {
    const version = await manager
      .getRepository(OrderFieldVersionEntity)
      .findOneBy({ orderId, fieldName });

    return !version || timestamp > version.lastEventTimestamp;
  }

  async upsertFieldVersion(
    manager: EntityManager,
    orderId: string,
    fieldName: OrderVersionedField,
    timestamp: number,
    eventId: string,
  ): Promise<void> {
    await manager.getRepository(OrderFieldVersionEntity).save(
      manager.getRepository(OrderFieldVersionEntity).create({
        orderId,
        fieldName,
        lastEventTimestamp: timestamp,
        lastEventId: eventId,
      }),
    );
  }
}
