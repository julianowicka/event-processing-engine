import { Injectable } from '@nestjs/common';
import type { JsonObject, JsonValue } from '../../../common/json.types';
import type { OrderEntity } from '../../../database/entities';
import { OrderVersionedField } from '../../types/event.types';
import { EventMoneyService } from './event-money.service';
import type { OrderEventHandlingContext } from './handlers/order-event-handler';

export interface VersionedFieldChange {
  column: keyof Pick<OrderEntity, 'amountMinor' | 'currency'>;
  field: OrderVersionedField;
  value: JsonValue;
}

@Injectable()
export class OrderPayloadReaderService {
  constructor(private readonly money: EventMoneyService) {}

  async readOrderUpdateChanges(
    context: OrderEventHandlingContext,
  ): Promise<VersionedFieldChange[]> {
    const changes: VersionedFieldChange[] = [];
    const amountMinor = await this.money.readNonNegativeAmountMinor(
      context.event.payload,
      'amount',
    );
    const currency = await this.readCurrency(context.event.payload);

    if (amountMinor !== null) {
      changes.push({
        column: 'amountMinor',
        field: OrderVersionedField.AmountMinor,
        value: amountMinor,
      });
    }

    if (currency !== null) {
      changes.push({
        column: 'currency',
        field: OrderVersionedField.Currency,
        value: currency,
      });
    }

    return changes;
  }

  async readCurrency(payload: JsonObject): Promise<string | null> {
    await Promise.resolve();

    const value = payload.currency;

    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : null;
  }
}
