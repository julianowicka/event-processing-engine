import { Check, Column, Entity, PrimaryColumn } from 'typeorm';
import { OrderVersionedField } from '../../events/types/event.types';

@Entity('order_field_versions')
@Check(
  'chk_order_field_versions_field',
  "field_name IN ('status', 'amountMinor', 'currency')",
)
export class OrderFieldVersionEntity {
  @PrimaryColumn({ name: 'order_id', type: 'text' })
  orderId!: string;

  @PrimaryColumn({ name: 'field_name', type: 'text' })
  fieldName!: OrderVersionedField;

  @Column({ name: 'last_event_timestamp', type: 'integer' })
  lastEventTimestamp!: number;

  @Column({ name: 'last_event_id', type: 'text' })
  lastEventId!: string;
}
