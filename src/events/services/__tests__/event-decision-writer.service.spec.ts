import { EntityManager, type DeepPartial } from 'typeorm';
import {
  EngineStatsEntity,
  EventDecisionEntity,
  RawIncomingEventEntity,
} from '../../../database/entities';
import {
  EngineDecision,
  ProcessingStatus,
  ReasonCode,
} from '../../types/event.types';
import { EventDecisionWriterService } from '../event-processing/event-decision-writer.service';

describe('EventDecisionWriterService', () => {
  it('completes exhausted technical failures as failed decisions', async () => {
    const eventDecisions = {
      create: jest.fn((decision: DeepPartial<EventDecisionEntity>) =>
        Object.assign(new EventDecisionEntity(), decision),
      ),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const rawEvents = {
      update: jest.fn().mockResolvedValue(undefined),
    };
    const statsRow = Object.assign(new EngineStatsEntity(), {
      id: 1,
      validEventsCount: 0,
      rejectedEventsCount: 0,
      duplicateEventsCount: 0,
      processedEventsCount: 0,
      totalProcessingTimeMs: 0,
      updatedAt: '',
    });
    const stats = {
      findOneBy: jest.fn().mockResolvedValue(statsRow),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const manager = Object.assign(
      Object.create(EntityManager.prototype) as EntityManager,
      {
        getRepository: jest.fn((entity: object) => {
          if (entity === EventDecisionEntity) {
            return eventDecisions;
          }
          if (entity === RawIncomingEventEntity) {
            return rawEvents;
          }
          if (entity === EngineStatsEntity) {
            return stats;
          }
          throw new Error('Unexpected repository requested');
        }),
      },
    );
    const delivery = Object.assign(new RawIncomingEventEntity(), { id: 7 });

    await new EventDecisionWriterService().writeFailedDecision(
      manager,
      delivery,
      'database unavailable',
      12,
    );

    expect(eventDecisions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        rawIncomingEventId: 7,
        decision: EngineDecision.Failed,
        reasonCode: ReasonCode.ProcessingError,
        reasonMessage: 'database unavailable',
      }),
    );
    expect(rawEvents.update).toHaveBeenCalledWith(
      { id: 7 },
      expect.objectContaining({
        processingStatus: ProcessingStatus.Done,
        lastErrorMessage: 'database unavailable',
      }),
    );
    expect(stats.save).toHaveBeenCalledWith(
      expect.objectContaining({
        processedEventsCount: 1,
        rejectedEventsCount: 1,
        totalProcessingTimeMs: 12,
      }),
    );
  });
});
