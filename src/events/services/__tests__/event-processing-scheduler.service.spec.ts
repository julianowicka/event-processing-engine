import { RawIncomingEventEntity } from '../../../database/entities';
import { RawIncomingEventRepository } from '../../repositories';
import { ProcessingStatus } from '../../types/event.types';
import { EventProcessingSchedulerService } from '../event-processing-scheduler.service';
import { EventProcessingService } from '../event-processing/event-processing.service';

type Find = RawIncomingEventRepository['find'];

describe('EventProcessingSchedulerService', () => {
  it('fetches raw incoming events with pending or retry status', async () => {
    const find = createFindMock();
    const service = new EventProcessingSchedulerService(createRepository(find));

    await expect(service.pollPendingOrRetryEvents()).resolves.toEqual([]);

    expect(find).toHaveBeenCalledWith({
      where: [
        { processingStatus: ProcessingStatus.Pending },
        { processingStatus: ProcessingStatus.Retry },
      ],
      order: {
        eventTimestamp: { direction: 'ASC', nulls: 'LAST' },
        id: 'ASC',
      },
    });
  });

  it('fetches once after module init', async () => {
    const find = createFindMock();
    const service = new EventProcessingSchedulerService(createRepository(find));

    await service.onModuleInit();
    expect(find).toHaveBeenCalledTimes(1);
  });

  it('fetches on scheduler interval tick', async () => {
    const find = createFindMock();
    const service = new EventProcessingSchedulerService(createRepository(find));

    await service.handlePollingInterval();
    expect(find).toHaveBeenCalledTimes(1);
  });

  it('processes available events in the order returned by the database', async () => {
    const events = [
      createRawIncomingEvent(3, 100),
      createRawIncomingEvent(4, 100),
      createRawIncomingEvent(1, 300),
      createRawIncomingEvent(2, null),
    ];
    const processEvent = jest
      .fn<Promise<void>, [RawIncomingEventEntity]>()
      .mockResolvedValue(undefined);
    const eventProcessingService = Object.assign(
      Object.create(EventProcessingService.prototype) as EventProcessingService,
      { processEvent },
    );
    const service = new EventProcessingSchedulerService(
      createRepository(createFindMock(events)),
      eventProcessingService,
    );

    await expect(service.pollPendingOrRetryEvents()).resolves.toEqual(events);
    expect(processEvent.mock.calls.map(([event]) => event.id)).toEqual([
      3, 4, 1, 2,
    ]);
  });
});

function createFindMock(
  events: RawIncomingEventEntity[] = [],
): jest.MockedFunction<Find> {
  return jest
    .fn<ReturnType<Find>, Parameters<Find>>()
    .mockResolvedValue(events);
}

function createRepository(find: Find): RawIncomingEventRepository {
  return Object.assign(
    Object.create(
      RawIncomingEventRepository.prototype,
    ) as RawIncomingEventRepository,
    { find },
  );
}

function createRawIncomingEvent(
  id: number,
  eventTimestamp: number | null,
): RawIncomingEventEntity {
  return Object.assign(new RawIncomingEventEntity(), {
    id,
    eventId: `evt-${id}`,
    orderId: 'order-1',
    type: 'order.created',
    eventTimestamp,
    rawEventJson: '{}',
    receivedAt: '2026-05-26T00:00:00.000Z',
    processingStatus: ProcessingStatus.Pending,
    availableAt: '2000-01-01T00:00:00.000Z',
    attempts: 0,
    lastErrorMessage: null,
  });
}
