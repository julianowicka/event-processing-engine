import { Column, Entity, PrimaryColumn } from 'typeorm';
import { OrderVersionedField } from '../../events/event.types';

@Entity('order_field_versions')
export class OrderFieldVersionEntity {
  @PrimaryColumn({ name: 'order_id', type: 'text' })
  orderId!: string;

  @PrimaryColumn({ name: 'field_name', type: 'text' })
  fieldName!: OrderVersionedField;

  @Column({ name: 'last_event_timestamp', type: 'integer' })
  lastEventTimestamp!: number;

  @Column({ name: 'last_event_id', type: 'text' })
  lastEventId!: string;

  @Column({ name: 'updated_at', type: 'text' })
  updatedAt!: string;
}
