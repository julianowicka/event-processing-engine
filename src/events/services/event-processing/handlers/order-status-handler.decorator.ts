import { SetMetadata } from '@nestjs/common';
import { OrderStatus } from '../../../types/event.types';

export const ORDER_STATUS_HANDLER_METADATA = Symbol('ORDER_STATUS_HANDLER');

export const HandlesOrderStatus = (status: OrderStatus): ClassDecorator =>
  SetMetadata(ORDER_STATUS_HANDLER_METADATA, status);
