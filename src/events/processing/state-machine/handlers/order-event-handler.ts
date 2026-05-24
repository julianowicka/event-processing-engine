import type { SupportedEventType, ValidOrderEvent } from '../../../event.types';
import type {
  OrderEventStateMachineContext,
  OrderEventStateMachineResult,
} from '../../event-processing.types';

export interface OrderEventHandler {
  readonly type: SupportedEventType;

  apply(
    event: ValidOrderEvent,
    context: OrderEventStateMachineContext,
  ): OrderEventStateMachineResult;
}
