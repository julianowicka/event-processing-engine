import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('dead_letter_events')
export class DeadLetterEventEntity {
  @PrimaryColumn({ name: 'raw_incoming_event_id', type: 'integer' })
  rawIncomingEventId!: number;

  @Column({ name: 'error_message', type: 'text' })
  errorMessage!: string;

  @Column({ name: 'created_at', type: 'text' })
  createdAt!: string;
}
