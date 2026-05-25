import { ProcessingStatus } from '../../types/event.types';
import { QueueEventsMode, QueuedEventStatus } from '../../types/events.types';
import { RawIncomingEventRepository } from '../../repositories';
import { EventEnqueuerService } from '../event-enqueuer.service';
import { RawEventsFactory } from '../../factory/raw-events.factory';

describe('EventEnqueuerService', () => {
  it('persists raw incoming event rows and returns queued results', async () => {
    const createMany = jest.fn(
      (rows: Parameters<RawIncomingEventRepository['createMany']>[0]) =>
        Promise.resolve(rows.map((row, index) => ({ id: index + 1, ...row }))),
    );
    const service = new EventEnqueuerService(
      Object.assign(
        Object.create(
          RawIncomingEventRepository.prototype,
        ) as RawIncomingEventRepository,
        { createMany },
      ),
      new RawEventsFactory(),
    );

    const result = await service.enqueueBatch([
      {
        eventId: 'evt-1',
        orderId: 'ord-1',
        type: 'ORDER_CREATED',
        timestamp: 1710001000,
        payload: { amount: 120 },
      },
      'not-an-object',
      { eventId: 100, timestamp: 'bad' },
    ]);

    expect(createMany).toHaveBeenCalledWith([
      expect.objectContaining({
        eventId: 'evt-1',
        orderId: 'ord-1',
        type: 'ORDER_CREATED',
        eventTimestamp: 1710001000,
        rawEventJson: JSON.stringify({
          eventId: 'evt-1',
          orderId: 'ord-1',
          type: 'ORDER_CREATED',
          timestamp: 1710001000,
          payload: { amount: 120 },
        }),
        processingStatus: ProcessingStatus.Pending,
        attempts: 0,
        lastErrorMessage: null,
      }),
      expect.objectContaining({
        eventId: null,
        orderId: null,
        type: null,
        eventTimestamp: null,
        rawEventJson: JSON.stringify('not-an-object'),
      }),
      expect.objectContaining({
        eventId: null,
        orderId: null,
        type: null,
        eventTimestamp: null,
        rawEventJson: JSON.stringify({ eventId: 100, timestamp: 'bad' }),
      }),
    ]);
    expect(createMany.mock.calls[0][0][0].receivedAt).toBe(
      createMany.mock.calls[0][0][0].availableAt,
    );
    expect(result).toEqual({
      mode: QueueEventsMode.AsyncWorker,
      results: [
        {
          incomingEventId: 1,
          eventId: 'evt-1',
          orderId: 'ord-1',
          type: 'ORDER_CREATED',
          status: QueuedEventStatus.Queued,
          reasonCode: null,
          reasonMessage: 'Queued for asynchronous processing',
          processingTimeMs: 0,
        },
        {
          incomingEventId: 2,
          eventId: null,
          orderId: null,
          type: null,
          status: QueuedEventStatus.Queued,
          reasonCode: null,
          reasonMessage: 'Queued for asynchronous processing',
          processingTimeMs: 0,
        },
        {
          incomingEventId: 3,
          eventId: null,
          orderId: null,
          type: null,
          status: QueuedEventStatus.Queued,
          reasonCode: null,
          reasonMessage: 'Queued for asynchronous processing',
          processingTimeMs: 0,
        },
      ],
      summary: {
        queued: 3,
      },
    });
  });
});
