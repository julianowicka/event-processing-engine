import { Check, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { ProcessingStatus } from '../../events/types/event.types';

@Entity('raw_incoming_events')
@Check(
  'chk_raw_processing_status',
  "processing_status IN ('PENDING', 'RETRY', 'DONE')",
)
@Check('chk_raw_attempts', 'attempts >= 0')
@Index('idx_raw_processing_queue', ['processingStatus', 'availableAt', 'id'])
@Index('idx_raw_order_id', ['orderId', 'id'])
@Index('idx_raw_event_id', ['eventId', 'id'])
export class RawIncomingEventEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'event_id', type: 'text', nullable: true })
  eventId!: string | null;

  @Column({ name: 'order_id', type: 'text', nullable: true })
  orderId!: string | null;

  @Column({ type: 'text', nullable: true })
  type!: string | null;

  @Column({ name: 'event_timestamp', type: 'integer', nullable: true })
  eventTimestamp!: number | null;

  @Column({ name: 'raw_event_json', type: 'text' })
  rawEventJson!: string;

  @Column({ name: 'received_at', type: 'text' })
  receivedAt!: string;

  @Column({
    name: 'processing_status',
    type: 'text',
    default: ProcessingStatus.Pending,
  })
  processingStatus!: ProcessingStatus;

  @Column({ name: 'available_at', type: 'text' })
  availableAt!: string;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ name: 'last_error_message', type: 'text', nullable: true })
  lastErrorMessage!: string | null;
}
