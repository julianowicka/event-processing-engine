import { Injectable } from '@nestjs/common';
import type { OrderStatus } from '../event.types';

@Injectable()
export class OrderStateMachineService {
  canTransition(from: OrderStatus, to: OrderStatus): boolean {
    if (from === to) {
      return true;
    }

    const allowed: Record<OrderStatus, OrderStatus[]> = {
      CREATED: ['PAID', 'CANCELLED'],
      PAID: ['PARTIALLY_REFUNDED', 'REFUNDED'],
      CANCELLED: [],
      PARTIALLY_REFUNDED: ['REFUNDED'],
      REFUNDED: [],
    };

    return allowed[from].includes(to);
  }
}
