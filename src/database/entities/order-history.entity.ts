import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type {
  OrderHistoryDecision,
  OrderStatus,
} from '../../events/event.types';

@Entity('order_history')
@Index('idx_order_history_order_id', ['orderId', 'id'])
export class OrderHistoryEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'order_id', type: 'text' })
  orderId!: string;

  @Column({ name: 'event_id', type: 'text' })
  eventId!: string;

  @Column({ name: 'event_type', type: 'text' })
  eventType!: string;

  @Column({ name: 'event_timestamp', type: 'integer' })
  eventTimestamp!: number;

  @Column({ name: 'processed_at', type: 'text' })
  processedAt!: string;

  @Column({ name: 'from_status', type: 'text', nullable: true })
  fromStatus!: OrderStatus | null;

  @Column({ name: 'to_status', type: 'text' })
  toStatus!: OrderStatus;

  @Column({ name: 'changed_fields_json', type: 'text', default: '{}' })
  changedFieldsJson!: string;

  @Column({ name: 'skipped_fields_json', type: 'text', default: '{}' })
  skippedFieldsJson!: string;

  @Column({ type: 'text' })
  decision!: OrderHistoryDecision;

  @Column({ name: 'reason_code', type: 'text' })
  reasonCode!: string;

  @Column({ name: 'created_at', type: 'text' })
  createdAt!: string;
}
