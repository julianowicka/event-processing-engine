import { Injectable } from '@nestjs/common';
import type { JsonObject } from '../../../common/json.types';
import { OrderEntity } from '../../../database/entities';
import { EngineDecision, ReasonCode } from '../../types/event.types';
import { EventDecisionWriterService } from './event-decision-writer.service';
import type { OrderEventHandlingContext } from './handlers/order-event-handler';
import { OrderApplicationDecisionService } from './order-application-decision.service';
import { OrderFieldVersionService } from './order-field-version.service';
import { OrderPayloadReaderService } from './order-payload-reader.service';

@Injectable()
export class OrderUpdateApplicationService {
  constructor(
    private readonly decision: OrderApplicationDecisionService,
    private readonly decisionWriter: EventDecisionWriterService,
    private readonly fieldVersions: OrderFieldVersionService,
    private readonly payloadReader: OrderPayloadReaderService,
  ) {}

  async updateOrderFields(context: OrderEventHandlingContext): Promise<void> {
    if (!context.order) {
      await this.decision.retryOrReject(
        context,
        ReasonCode.OrderNotReady,
        'Event requires an existing order',
      );
      return;
    }

    const changedFields: JsonObject = {};
    const skippedFields: JsonObject = {};
    const orderPatch: Partial<OrderEntity> = {};

    for (const change of await this.payloadReader.readOrderUpdateChanges(
      context,
    )) {
      if (await this.canApplyChange(context, change.field)) {
        changedFields[change.field] = change.value;
        orderPatch[change.column] = change.value as never;
        await this.upsertFieldVersion(context, change.field);
      } else {
        skippedFields[change.field] = ReasonCode.ObsoleteField;
      }
    }

    if (Object.prototype.hasOwnProperty.call(context.event.payload, 'status')) {
      skippedFields.status = ReasonCode.ForbiddenTransition;
    }

    if (Object.keys(changedFields).length === 0) {
      await this.decision.reject(
        context,
        ReasonCode.NoApplicableChanges,
        'ORDER_UPDATED did not contain any applicable field changes',
        skippedFields,
      );
      return;
    }

    await this.applyPatch(context, orderPatch);
    await this.writeDecision(context, changedFields, skippedFields);
  }

  private async canApplyChange(
    context: OrderEventHandlingContext,
    fieldName: Parameters<OrderFieldVersionService['canApplyField']>[2],
  ): Promise<boolean> {
    return this.fieldVersions.canApplyField(
      context.manager,
      context.event.orderId,
      fieldName,
      context.event.timestamp,
    );
  }

  private async upsertFieldVersion(
    context: OrderEventHandlingContext,
    fieldName: Parameters<OrderFieldVersionService['upsertFieldVersion']>[2],
  ): Promise<void> {
    await this.fieldVersions.upsertFieldVersion(
      context.manager,
      context.event.orderId,
      fieldName,
      context.event.timestamp,
      context.event.eventId,
    );
  }

  private async applyPatch(
    context: OrderEventHandlingContext,
    orderPatch: Partial<OrderEntity>,
  ): Promise<void> {
    await context.manager.getRepository(OrderEntity).update(
      { orderId: context.order!.orderId },
      {
        ...orderPatch,
        updatedAt: new Date().toISOString(),
      },
    );
  }

  private async writeDecision(
    context: OrderEventHandlingContext,
    changedFields: JsonObject,
    skippedFields: JsonObject,
  ): Promise<void> {
    const hasSkippedFields = Object.keys(skippedFields).length > 0;

    await this.decisionWriter.writeFinalDecision({
      manager: context.manager,
      delivery: context.delivery,
      decision: hasSkippedFields
        ? EngineDecision.PartiallyApplied
        : EngineDecision.Accepted,
      reasonCode: hasSkippedFields
        ? ReasonCode.PartialMerge
        : ReasonCode.Applied,
      reasonMessage: hasSkippedFields
        ? 'Order fields were partially merged'
        : 'Order fields were updated',
      fromStatus: context.order!.status,
      toStatus: context.order!.status,
      changedFields,
      skippedFields,
      processingTimeMs: await context.getProcessingTimeMs(),
    });
  }
}
