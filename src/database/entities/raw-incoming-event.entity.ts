import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('raw_incoming_events')
@Index('idx_raw_incoming_events_order_id', ['orderId'])
@Index('idx_raw_incoming_events_event_id', ['eventId'])
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

  @Column({ name: 'payload_json', type: 'text', nullable: true })
  payloadJson!: string | null;

  @Column({ name: 'received_at', type: 'text' })
  receivedAt!: string;
}
