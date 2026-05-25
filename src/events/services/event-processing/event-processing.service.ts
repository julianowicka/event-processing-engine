import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { getEventRetryDelayMs } from '../../../env';
import {
  EventDecisionEntity,
  OrderEntity,
  ProcessedEventKeyEntity,
  RawIncomingEventEntity,
} from '../../../database/entities';
import { DatabaseService } from '../../../database/database.service';
import {
  EngineDecision,
  OrderStatus,
  ReasonCode,
  SupportedEventType,
} from '../../types/event.types';
import { EventDecisionWriterService } from './event-decision-writer.service';
import { EventValidationService } from './event-validation.service';
import { OrderEventHandlerFactory } from './handlers/order-event-handler.factory';

const MAX_PROCESSING_ATTEMPTS = 3;

@Injectable()
export class EventProcessingService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly decisionWriter: EventDecisionWriterService,
    private readonly eventValidationService: EventValidationService,
    private readonly orderEventHandlerFactory: OrderEventHandlerFactory,
  ) {}

  async processEvent(event: RawIncomingEventEntity): Promise<void> {
    const startedAt = Date.now();

    try {
      await this.databaseService.transaction(async (manager) => {
        const existingDecision = await manager
          .getRepository(EventDecisionEntity)
          .findOneBy({ rawIncomingEventId: event.id });

        if (existingDecision) {
          return;
        }

        const validation = await this.eventValidationService.validate(event);

        if (!validation.valid) {
          await this.decisionWriter.writeFinalDecision({
            manager,
            delivery: event,
            decision: EngineDecision.Rejected,
            reasonCode: validation.reasonCode,
            reasonMessage: validation.reasonMessage,
            processingTimeMs: await this.processingTimeMs(startedAt),
          });
          return;
        }

        if (
          !(await this.claimEventId(
            manager,
            validation.event.eventId,
            event.id,
          ))
        ) {
          await this.decisionWriter.writeFinalDecision({
            manager,
            delivery: event,
            decision: EngineDecision.Duplicate,
            reasonCode: ReasonCode.DuplicateEvent,
            reasonMessage: 'eventId was already processed by another delivery',
            processingTimeMs: await this.processingTimeMs(startedAt),
          });
          return;
        }

        const order = await manager.getRepository(OrderEntity).findOneBy({
          orderId: validation.event.orderId,
        });
        const orderStatus = order?.status ?? OrderStatus.DoesNotExist;
        const orderEventHandler =
          await this.orderEventHandlerFactory.createOrderEventHandler(
            orderStatus,
          );
        const context = {
          manager,
          order,
          event: validation.event,
          delivery: event,
          getProcessingTimeMs: async (): Promise<number> =>
            this.processingTimeMs(startedAt),
        };

        switch (validation.event.type) {
          case SupportedEventType.OrderCreated:
            await orderEventHandler.handleOrderCreatedEvent(context);
            return;
          case SupportedEventType.OrderUpdated:
            await orderEventHandler.handleOrderUpdatedEvent(context);
            return;
          case SupportedEventType.PaymentCaptured:
            await orderEventHandler.handlePaymentCapturedEvent(context);
            return;
          case SupportedEventType.OrderCancelled:
            await orderEventHandler.handleOrderCancelledEvent(context);
            return;
          case SupportedEventType.RefundIssued:
            await orderEventHandler.handleRefundIssuedEvent(context);
            return;
        }
      });
    } catch (error) {
      await this.handleUnexpectedFailure(
        event,
        error instanceof Error ? error.message : 'Unexpected processing error',
        await this.processingTimeMs(startedAt),
      );
    }
  }

  private async claimEventId(
    manager: EntityManager,
    eventId: string,
    rawIncomingEventId: number,
  ): Promise<boolean> {
    const repository = manager.getRepository(ProcessedEventKeyEntity);
    const existingKey = await repository.findOneBy({ eventId });

    if (existingKey) {
      return existingKey.firstRawIncomingEventId === rawIncomingEventId;
    }

    await repository.save(
      repository.create({
        eventId,
        firstRawIncomingEventId: rawIncomingEventId,
      }),
    );

    return true;
  }

  private async handleUnexpectedFailure(
    event: RawIncomingEventEntity,
    errorMessage: string,
    processingTimeMs: number,
  ): Promise<void> {
    await this.databaseService.transaction(async (manager) => {
      const latest = await manager
        .getRepository(RawIncomingEventEntity)
        .findOneBy({ id: event.id });

      if (!latest) {
        return;
      }

      if (latest.attempts + 1 >= MAX_PROCESSING_ATTEMPTS) {
        await this.decisionWriter.writeFailedDecision(
          manager,
          latest,
          errorMessage,
          processingTimeMs,
        );
        return;
      }

      await this.decisionWriter.markRetryableFailure(
        manager,
        latest,
        errorMessage,
        new Date(Date.now() + getEventRetryDelayMs()).toISOString(),
      );
    });
  }

  private async processingTimeMs(startedAt: number): Promise<number> {
    await Promise.resolve();

    return Math.max(Date.now() - startedAt, 0);
  }
}
