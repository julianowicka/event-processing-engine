import { ObjectLiteral, Repository } from 'typeorm';
import {
  EventDecisionEntity,
  OrderEntity,
  RawIncomingEventEntity,
} from '../../database/entities';
import { ProcessingStatus } from '../../events/types/event.types';
import { OrdersService } from '../orders.service';

describe('OrdersService', () => {
  it('returns an order view when only a retrying event exists', async () => {
    const rawEvent = Object.assign(new RawIncomingEventEntity(), {
      id: 7,
      eventId: 'evt-retry-1',
      orderId: 'ord-retry-1',
      type: 'PAYMENT_CAPTURED',
      eventTimestamp: 1710002000,
      receivedAt: '2026-05-25T10:00:00.000Z',
      processingStatus: ProcessingStatus.Retry,
      availableAt: '2026-05-25T11:00:00.000Z',
      attempts: 1,
      lastErrorMessage: 'Event requires an existing order',
    });
    const orders = createRepository<OrderEntity>({
      findOneBy: jest.fn().mockResolvedValue(null),
    });
    const decisions = createRepository<EventDecisionEntity>({
      find: jest.fn().mockResolvedValue([]),
    });
    const rawEvents = createRepository<RawIncomingEventEntity>({
      find: jest.fn().mockResolvedValue([rawEvent]),
    });
    const service = new OrdersService(orders, decisions, rawEvents);

    await expect(service.getOrderDetails('ord-retry-1')).resolves.toMatchObject(
      {
        orderId: 'ord-retry-1',
        currentState: null,
        history: [],
        rejectedEvents: [],
        auditLog: [],
        pendingJobs: [
          {
            rawIncomingEventId: 7,
            status: ProcessingStatus.Retry,
            attempts: 1,
            availableAt: '2026-05-25T11:00:00.000Z',
          },
        ],
      },
    );
  });
});

function createRepository<Entity extends ObjectLiteral>(
  methods: Partial<Repository<Entity>>,
): Repository<Entity> {
  return Object.assign(Object.create(null) as Repository<Entity>, methods);
}
