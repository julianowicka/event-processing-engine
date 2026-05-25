import { Injectable } from '@nestjs/common';
import type { JsonObject } from '../../../common/json.types';
import { OrderEntity } from '../../../database/entities';
import { OrderStatus, OrderVersionedField } from '../../types/event.types';
import { EventMoneyService } from './event-money.service';
import type { OrderEventHandlingContext } from './handlers/order-event-handler';
import { OrderApplicationDecisionService } from './order-application-decision.service';
import { OrderFieldVersionService } from './order-field-version.service';
import { OrderPayloadReaderService } from './order-payload-reader.service';

@Injectable()
export class OrderCreationApplicationService {
  constructor(
    private readonly decision: OrderApplicationDecisionService,
    private readonly fieldVersions: OrderFieldVersionService,
    private readonly money: EventMoneyService,
    private readonly payloadReader: OrderPayloadReaderService,
  ) {}

  async createOrder(context: OrderEventHandlingContext): Promise<void> {
    const amountMinor = await this.money.readNonNegativeAmountMinor(
      context.event.payload,
      'amount',
    );
    const currency = await this.payloadReader.readCurrency(
      context.event.payload,
    );
    const now = new Date().toISOString();
    const changedFields = await this.buildChangedFields(amountMinor, currency);

    await context.manager.getRepository(OrderEntity).save(
      context.manager.getRepository(OrderEntity).create({
        orderId: context.event.orderId,
        status: OrderStatus.Created,
        amountMinor,
        currency,
        paidAmountMinor: 0,
        refundedAmountMinor: 0,
        createdAt: now,
        updatedAt: now,
      }),
    );

    await this.writeFieldVersions(context, amountMinor, currency);
    await this.decision.accept(
      context,
      null,
      OrderStatus.Created,
      changedFields,
    );
  }

  private async buildChangedFields(
    amountMinor: number | null,
    currency: string | null,
  ): Promise<JsonObject> {
    await Promise.resolve();

    const changedFields: JsonObject = { status: OrderStatus.Created };

    if (amountMinor !== null) {
      changedFields.amountMinor = amountMinor;
    }

    if (currency !== null) {
      changedFields.currency = currency;
    }

    return changedFields;
  }

  private async writeFieldVersions(
    context: OrderEventHandlingContext,
    amountMinor: number | null,
    currency: string | null,
  ): Promise<void> {
    await this.upsertFieldVersion(context, OrderVersionedField.Status);

    if (amountMinor !== null) {
      await this.upsertFieldVersion(context, OrderVersionedField.AmountMinor);
    }

    if (currency !== null) {
      await this.upsertFieldVersion(context, OrderVersionedField.Currency);
    }
  }

  private async upsertFieldVersion(
    context: OrderEventHandlingContext,
    fieldName: OrderVersionedField,
  ): Promise<void> {
    await this.fieldVersions.upsertFieldVersion(
      context.manager,
      context.event.orderId,
      fieldName,
      context.event.timestamp,
      context.event.eventId,
    );
  }
}
