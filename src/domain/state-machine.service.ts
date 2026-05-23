import { Injectable } from '@nestjs/common';
import { OrderStatus } from './types';

type StartingStatus = OrderStatus | 'NEW';

@Injectable()
export class StateMachineService {
  canTransition(from: StartingStatus, to: OrderStatus) {
    if (from === to) {
      return { allowed: true, reason: 'Status is already applied' };
    }

    const allowed: Record<StartingStatus, OrderStatus[]> = {
      NEW: ['CREATED'],
      CREATED: ['PAID', 'CANCELLED'],
      PAID: ['PARTIALLY_REFUNDED', 'REFUNDED'],
      PARTIALLY_REFUNDED: ['PARTIALLY_REFUNDED', 'REFUNDED'],
      REFUNDED: [],
      CANCELLED: [],
    };

    if (allowed[from].includes(to)) {
      return { allowed: true, reason: 'Transition is allowed' };
    }

    return {
      allowed: false,
      reason: `Transition ${from} -> ${to} is not allowed`,
    };
  }
}
