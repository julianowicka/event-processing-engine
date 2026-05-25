import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DataSource, type DataSourceOptions } from 'typeorm';
import type { JsonObject } from '../../common/json.types';
import { DatabaseService } from '../../database/database.service';
import {
  EventDecisionEntity,
  EventProcessingJobEntity,
  RawIncomingEventEntity,
} from '../../database/entities';
import { createTypeOrmOptions } from '../../database/typeorm.config';
import { EventProcessingService } from '../event-processing.service';
import { EventsRepository } from '../events.repository';
import { EngineDecision, ReasonCode, SupportedEventType } from '../event.types';
import { EventAuditRepository } from '../processing/event-audit.repository';
import { EventDecisionService } from '../processing/event-decision.service';
import { EventJobCompletionService } from '../processing/event-job-completion.service';
import { EventJobRepository } from '../processing/event-job.repository';
import { EventValidationService } from '../processing/event-validation.service';
import { OrderRepository } from '../processing/order.repository';
import { OrderCancelledEventHandler } from '../processing/state-machine/handlers/order-cancelled-event.handler';
import { OrderCreatedEventHandler } from '../processing/state-machine/handlers/order-created-event.handler';
import { OrderUpdatedEventHandler } from '../processing/state-machine/handlers/order-updated-event.handler';
import { PaymentCapturedEventHandler } from '../processing/state-machine/handlers/payment-captured-event.handler';
import { RefundIssuedEventHandler } from '../processing/state-machine/handlers/refund-issued-event.handler';
import { OrderEventStateMachineService } from '../processing/state-machine/order-event-state-machine.service';
import { OrderStatusTransitionRulesService } from '../processing/state-machine/order-status-transition-rules.service';
import { OrderUpdatedEventFieldsService } from '../processing/state-machine/order-updated-event-fields.service';

describe('EventProcessingService payment and refund guards', () => {
  let directory: string;
  let previousDbPath: string | undefined;
  let dataSource: DataSource;
  let eventsRepository: EventsRepository;
  let service: EventProcessingService;

  beforeEach(async () => {
    previousDbPath = process.env.SQLITE_DB_PATH;
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'event-processing-'));
    process.env.SQLITE_DB_PATH = path.join(directory, 'database.sqlite');
    dataSource = new DataSource(createTypeOrmOptions() as DataSourceOptions);
    await dataSource.initialize();

    const databaseService = new DatabaseService(dataSource);
    const validationService = new EventValidationService();
    const statusTransitionRules = new OrderStatusTransitionRulesService();
    const orderUpdatedEventFields = new OrderUpdatedEventFieldsService(
      validationService,
      statusTransitionRules,
    );
    const decisionService = new EventDecisionService();
    const jobRepository = new EventJobRepository(databaseService);
    const orderRepository = new OrderRepository();
    const auditRepository = new EventAuditRepository();
    eventsRepository = new EventsRepository(
      databaseService,
      dataSource.getRepository(RawIncomingEventEntity),
      dataSource.getRepository(EventProcessingJobEntity),
    );
    service = new EventProcessingService(
      databaseService,
      jobRepository,
      orderRepository,
      validationService,
      new OrderEventStateMachineService(
        new OrderCreatedEventHandler(validationService, decisionService),
        new OrderUpdatedEventHandler(orderUpdatedEventFields, decisionService),
        new PaymentCapturedEventHandler(
          validationService,
          statusTransitionRules,
          decisionService,
        ),
        new OrderCancelledEventHandler(statusTransitionRules, decisionService),
        new RefundIssuedEventHandler(
          validationService,
          statusTransitionRules,
          decisionService,
        ),
      ),
      decisionService,
      new EventJobCompletionService(
        databaseService,
        jobRepository,
        orderRepository,
        auditRepository,
        validationService,
        decisionService,
      ),
    );
  });

  afterEach(async () => {
    await dataSource.destroy();

    if (previousDbPath === undefined) {
      delete process.env.SQLITE_DB_PATH;
    } else {
      process.env.SQLITE_DB_PATH = previousDbPath;
    }

    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('rejects repeated payment capture and refunds above captured amount', async () => {
    await enqueue({
      eventId: 'evt-guards-001',
      orderId: 'ord-guards-001',
      type: SupportedEventType.OrderCreated,
      timestamp: 1710001000,
      payload: { amount: 50, currency: 'PLN' },
    });
    await enqueue({
      eventId: 'evt-guards-002',
      orderId: 'ord-guards-001',
      type: SupportedEventType.PaymentCaptured,
      timestamp: 1710002000,
      payload: { amount: 50 },
    });
    await enqueue({
      eventId: 'evt-guards-003',
      orderId: 'ord-guards-001',
      type: SupportedEventType.PaymentCaptured,
      timestamp: 1710003000,
      payload: { amount: 50 },
    });
    await enqueue({
      eventId: 'evt-guards-004',
      orderId: 'ord-guards-001',
      type: SupportedEventType.RefundIssued,
      timestamp: 1710004000,
      payload: { refundAmount: 60 },
    });

    while (await service.processNextAvailableJob()) {
      // Process queued jobs for this focused test.
    }

    const rejected = await dataSource.getRepository(EventDecisionEntity).find({
      where: { decision: EngineDecision.Rejected },
    });
    const reasonCounts = rejected.reduce<Record<string, number>>(
      (counts, decision) => {
        counts[decision.reasonCode] = (counts[decision.reasonCode] ?? 0) + 1;
        return counts;
      },
      {},
    );

    expect(reasonCounts).toMatchObject({
      [ReasonCode.PaymentAlreadyCaptured]: 1,
      [ReasonCode.RefundExceedsCaptured]: 1,
    });
  });

  async function enqueue(eventItem: {
    eventId: string;
    orderId: string;
    type: SupportedEventType;
    timestamp: number;
    payload: JsonObject;
  }): Promise<void> {
    await eventsRepository.enqueueBatch([
      {
        eventId: eventItem.eventId,
        orderId: eventItem.orderId,
        type: eventItem.type,
        timestamp: eventItem.timestamp,
        rawEventJson: JSON.stringify(eventItem),
        payloadJson: JSON.stringify(eventItem.payload),
      },
    ]);
  }
});
