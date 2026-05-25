import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('processed_event_keys')
@Index('idx_processed_event_keys_order_id', ['orderId'])
export class ProcessedEventKeyEntity {
  @PrimaryColumn({ name: 'event_id', type: 'text' })
  eventId!: string;

  @Column({ name: 'first_raw_incoming_event_id', type: 'integer' })
  firstRawIncomingEventId!: number;

  @Column({ name: 'order_id', type: 'text', nullable: true })
  orderId!: string | null;

  @Column({ name: 'first_seen_at', type: 'text' })
  firstSeenAt!: string;
}
