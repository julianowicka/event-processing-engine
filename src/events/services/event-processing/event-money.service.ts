import { Injectable } from '@nestjs/common';
import type { JsonObject } from '../../../common/json.types';

@Injectable()
export class EventMoneyService {
  async readPositiveAmountMinor(
    payload: JsonObject,
    fieldName: string,
  ): Promise<number | null> {
    const amountMinor = await this.readAmountMinor(payload, fieldName);

    return amountMinor !== null && amountMinor > 0 ? amountMinor : null;
  }

  async readNonNegativeAmountMinor(
    payload: JsonObject,
    fieldName: string,
  ): Promise<number | null> {
    const amountMinor = await this.readAmountMinor(payload, fieldName);

    return amountMinor !== null && amountMinor >= 0 ? amountMinor : null;
  }

  async readAmountMinor(
    payload: JsonObject,
    fieldName: string,
  ): Promise<number | null> {
    await Promise.resolve();

    const value = payload[fieldName];

    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null;
    }

    return Math.round(value * 100);
  }
}
