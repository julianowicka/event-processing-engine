import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('processed_event_keys')
export class ProcessedEventKeyEntity {
  @PrimaryColumn({ name: 'event_id', type: 'text' })
  eventId!: string;

  @Column({ name: 'first_raw_incoming_event_id', type: 'integer' })
  firstRawIncomingEventId!: number;
}
