import { EntityManager } from 'typeorm';
import { RawIncomingEventEntity } from '../../../database/entities';
import {
  EngineDecision,
  ReasonCode,
  SupportedEventType,
} from '../../types/event.types';
import { EventDecisionWriterService } from '../event-processing/event-decision-writer.service';
import type { OrderEventHandlingContext } from '../event-processing/handlers/order-event-handler';
import { OrderApplicationDecisionService } from '../event-processing/order-application-decision.service';

describe('OrderApplicationDecisionService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('retries a transient rejection one hour later before the limit', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-25T10:00:00.000Z'));
    const writer = new EventDecisionWriterService();
    const markRetryableFailure = jest
      .spyOn(writer, 'markRetryableFailure')
      .mockResolvedValue();
    const writeFinalDecision = jest
      .spyOn(writer, 'writeFinalDecision')
      .mockResolvedValue();
    const service = new OrderApplicationDecisionService(writer);
    const context = createContext(0);

    await service.retryOrReject(
      context,
      ReasonCode.OrderNotReady,
      'Event requires an existing order',
    );

    expect(markRetryableFailure).toHaveBeenCalledWith(
      context.manager,
      context.delivery,
      'Event requires an existing order',
      '2026-05-25T11:00:00.000Z',
    );
    expect(writeFinalDecision).not.toHaveBeenCalled();
  });

  it('rejects a transient failure on its third processing attempt', async () => {
    const writer = new EventDecisionWriterService();
    const markRetryableFailure = jest
      .spyOn(writer, 'markRetryableFailure')
      .mockResolvedValue();
    const writeFinalDecision = jest
      .spyOn(writer, 'writeFinalDecision')
      .mockResolvedValue();
    const service = new OrderApplicationDecisionService(writer);
    const context = createContext(2);

    await service.retryOrReject(
      context,
      ReasonCode.OrderNotReady,
      'Event requires an existing order',
    );

    expect(markRetryableFailure).not.toHaveBeenCalled();
    expect(writeFinalDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery: context.delivery,
        decision: EngineDecision.Rejected,
        reasonCode: ReasonCode.OrderNotReady,
        finalAttemptCount: 3,
      }),
    );
  });
});

function createContext(attempts: number): OrderEventHandlingContext {
  return {
    manager: Object.create(null) as EntityManager,
    order: null,
    event: {
      eventId: 'evt-retry-1',
      orderId: 'ord-retry-1',
      type: SupportedEventType.PaymentCaptured,
      timestamp: 1710002000,
      payload: { amount: 120 },
    },
    delivery: Object.assign(new RawIncomingEventEntity(), {
      id: 1,
      attempts,
    }),
    getProcessingTimeMs: jest.fn().mockResolvedValue(7),
  };
}
