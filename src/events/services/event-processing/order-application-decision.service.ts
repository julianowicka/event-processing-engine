import { Injectable } from '@nestjs/common';
import type { JsonObject } from '../../../common/json.types';
import {
  EngineDecision,
  OrderStatus,
  ReasonCode,
} from '../../types/event.types';
import { EventDecisionWriterService } from './event-decision-writer.service';
import type { OrderEventHandlingContext } from './handlers/order-event-handler';

@Injectable()
export class OrderApplicationDecisionService {
  constructor(private readonly decisionWriter: EventDecisionWriterService) {}

  async accept(
    context: OrderEventHandlingContext,
    fromStatus: OrderStatus | null,
    toStatus: OrderStatus,
    changedFields: JsonObject,
  ): Promise<void> {
    await this.decisionWriter.writeFinalDecision({
      manager: context.manager,
      delivery: context.delivery,
      decision: EngineDecision.Accepted,
      reasonCode: ReasonCode.Applied,
      reasonMessage: 'Event was applied',
      fromStatus,
      toStatus,
      changedFields,
      skippedFields: {},
      processingTimeMs: await context.getProcessingTimeMs(),
    });
  }

  async reject(
    context: OrderEventHandlingContext,
    reasonCode: ReasonCode,
    reasonMessage: string,
    skippedFields: JsonObject = {},
  ): Promise<void> {
    await this.decisionWriter.writeFinalDecision({
      manager: context.manager,
      delivery: context.delivery,
      decision: EngineDecision.Rejected,
      reasonCode,
      reasonMessage,
      fromStatus: context.order?.status ?? null,
      toStatus: context.order?.status ?? null,
      changedFields: {},
      skippedFields,
      processingTimeMs: await context.getProcessingTimeMs(),
    });
  }

  async rejectObsoleteStatus(
    context: OrderEventHandlingContext,
  ): Promise<void> {
    await this.reject(
      context,
      ReasonCode.ObsoleteEvent,
      'Lifecycle event is older than the current status version',
      {
        status: ReasonCode.ObsoleteField,
      },
    );
  }
}
