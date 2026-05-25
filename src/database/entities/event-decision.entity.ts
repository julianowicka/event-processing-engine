import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { EngineDecision, ReasonCode } from '../../events/event.types';

@Entity('event_decisions')
@Index('idx_event_decisions_order_id', ['orderId', 'id'])
@Index('idx_event_decisions_raw_incoming_event_id', ['rawIncomingEventId'])
@Index('idx_event_decisions_job_id', ['eventProcessingJobId'])
export class EventDecisionEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'raw_incoming_event_id', type: 'integer' })
  rawIncomingEventId!: number;

  @Column({ name: 'event_processing_job_id', type: 'integer' })
  eventProcessingJobId!: number;

  @Column({ name: 'event_id', type: 'text', nullable: true })
  eventId!: string | null;

  @Column({ name: 'order_id', type: 'text', nullable: true })
  orderId!: string | null;

  @Column({ type: 'text', nullable: true })
  type!: string | null;

  @Column({ type: 'integer', nullable: true })
  timestamp!: number | null;

  @Column({ type: 'text' })
  decision!: EngineDecision;

  @Column({ name: 'reason_code', type: 'text' })
  reasonCode!: ReasonCode;

  @Column({ name: 'reason_message', type: 'text' })
  reasonMessage!: string;

  @Column({ name: 'details_json', type: 'text', default: '{}' })
  detailsJson!: string;

  @Column({ name: 'processing_time_ms', type: 'integer', default: 0 })
  processingTimeMs!: number;

  @Column({ name: 'created_at', type: 'text' })
  createdAt!: string;
}
