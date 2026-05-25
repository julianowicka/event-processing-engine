import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { ReasonCode } from '../../events/event.types';

@Entity('dead_letter_events')
@Index('idx_dead_letter_events_raw_incoming_event_id', ['rawIncomingEventId'])
@Index('idx_dead_letter_events_job_id', ['eventProcessingJobId'])
export class DeadLetterEventEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'event_processing_job_id', type: 'integer' })
  eventProcessingJobId!: number;

  @Column({ name: 'raw_incoming_event_id', type: 'integer' })
  rawIncomingEventId!: number;

  @Column({ name: 'event_id', type: 'text', nullable: true })
  eventId!: string | null;

  @Column({ name: 'order_id', type: 'text', nullable: true })
  orderId!: string | null;

  @Column({ type: 'text', nullable: true })
  type!: string | null;

  @Column({ type: 'integer', nullable: true })
  timestamp!: number | null;

  @Column({ name: 'raw_event_json', type: 'text' })
  rawEventJson!: string;

  @Column({ name: 'reason_code', type: 'text' })
  reasonCode!: ReasonCode;

  @Column({ name: 'error_message', type: 'text' })
  errorMessage!: string;

  @Column({ type: 'integer' })
  attempts!: number;

  @Column({ name: 'created_at', type: 'text' })
  createdAt!: string;
}
