import { Injectable, Type } from '@nestjs/common';
import { DiscoveryService, ModuleRef } from '@nestjs/core';
import { OrderStatus } from '../../../types/event.types';
import { OrderEventHandler } from './order-event-handler';
import { ORDER_STATUS_HANDLER_METADATA } from './order-status-handler.decorator';

@Injectable()
export class OrderEventHandlerFactory {
  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly moduleRef: ModuleRef,
  ) {}

  async createOrderEventHandler(
    orderStatus: OrderStatus,
  ): Promise<OrderEventHandler> {
    const handlers = await this.getOrderEventHandlerTypes();
    const handler = handlers.get(orderStatus);

    if (!handler) {
      throw new Error(
        `Order event handler not found for status ${orderStatus}`,
      );
    }

    return this.moduleRef.get(handler, { strict: false });
  }

  private async getOrderEventHandlerTypes(): Promise<
    Map<OrderStatus, Type<OrderEventHandler>>
  > {
    await Promise.resolve();

    const handlers = new Map<OrderStatus, Type<OrderEventHandler>>();

    for (const provider of this.discoveryService.getProviders()) {
      if (!provider.metatype) {
        continue;
      }

      const status = Reflect.getMetadata(
        ORDER_STATUS_HANDLER_METADATA,
        provider.metatype,
      ) as OrderStatus | undefined;

      if (status) {
        handlers.set(status, provider.metatype as Type<OrderEventHandler>);
      }
    }

    return handlers;
  }
}
