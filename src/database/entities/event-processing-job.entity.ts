import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { JobStatus } from '../../events/event.types';

@Entity('event_processing_jobs')
@Index('idx_event_processing_jobs_status_available_id', [
  'status',
  'availableAt',
  'id',
])
@Index('idx_event_processing_jobs_raw_incoming_event_id', [
  'rawIncomingEventId',
])
@Index('idx_event_processing_jobs_lock', ['lockedBy', 'lockedAt'])
export class EventProcessingJobEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'raw_incoming_event_id', type: 'integer', unique: true })
  rawIncomingEventId!: number;

  @Column({ type: 'text' })
  status!: JobStatus;

  @Column({ name: 'available_at', type: 'text' })
  availableAt!: string;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ name: 'last_error_message', type: 'text', nullable: true })
  lastErrorMessage!: string | null;

  @Column({ name: 'last_decision_id', type: 'integer', nullable: true })
  lastDecisionId!: number | null;

  @Column({ name: 'last_reason_code', type: 'text', nullable: true })
  lastReasonCode!: string | null;

  @Column({ name: 'locked_by', type: 'text', nullable: true })
  lockedBy!: string | null;

  @Column({ name: 'locked_at', type: 'text', nullable: true })
  lockedAt!: string | null;

  @Column({ name: 'created_at', type: 'text' })
  createdAt!: string;

  @Column({ name: 'updated_at', type: 'text' })
  updatedAt!: string;
}
