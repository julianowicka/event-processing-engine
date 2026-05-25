import { RawIncomingEventRepository } from '../../repositories';
import { ProcessingStatus } from '../../types/event.types';
import { EventProcessingSchedulerService } from '../event-processing-scheduler.service';

type FindBy = RawIncomingEventRepository['findBy'];

describe('EventProcessingSchedulerService', () => {
  it('fetches raw incoming events with pending or retry status', async () => {
    const findBy = createFindByMock();
    const service = new EventProcessingSchedulerService(
      createRepository(findBy),
    );

    await expect(service.pollPendingOrRetryEvents()).resolves.toEqual([]);

    expect(findBy).toHaveBeenCalledWith([
      { processingStatus: ProcessingStatus.Pending },
      { processingStatus: ProcessingStatus.Retry },
    ]);
  });

  it('fetches once after module init', async () => {
    const findBy = createFindByMock();
    const service = new EventProcessingSchedulerService(
      createRepository(findBy),
    );

    service.onModuleInit();
    await Promise.resolve();
    expect(findBy).toHaveBeenCalledTimes(1);
  });

  it('fetches on scheduler interval tick', async () => {
    const findBy = createFindByMock();
    const service = new EventProcessingSchedulerService(
      createRepository(findBy),
    );

    service.handlePollingInterval();
    await Promise.resolve();
    expect(findBy).toHaveBeenCalledTimes(1);
  });
});

function createFindByMock(): jest.MockedFunction<FindBy> {
  return jest
    .fn<ReturnType<FindBy>, Parameters<FindBy>>()
    .mockResolvedValue([]);
}

function createRepository(findBy: FindBy): RawIncomingEventRepository {
  return Object.assign(
    Object.create(
      RawIncomingEventRepository.prototype,
    ) as RawIncomingEventRepository,
    { findBy },
  );
}
