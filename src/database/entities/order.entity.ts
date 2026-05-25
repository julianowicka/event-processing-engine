import { Column, Entity, PrimaryColumn } from 'typeorm';
import { OrderStatus } from '../../events/event.types';

@Entity('orders')
export class OrderEntity {
  @PrimaryColumn({ name: 'order_id', type: 'text' })
  orderId!: string;

  @Column({ type: 'text' })
  status!: OrderStatus;

  @Column({ name: 'amount_minor', type: 'integer', nullable: true })
  amountMinor!: number | null;

  @Column({ type: 'text', nullable: true })
  currency!: string | null;

  @Column({ name: 'paid_amount_minor', type: 'integer', default: 0 })
  paidAmountMinor!: number;

  @Column({ name: 'refunded_amount_minor', type: 'integer', default: 0 })
  refundedAmountMinor!: number;

  @Column({ type: 'integer', default: 1 })
  version!: number;

  @Column({ name: 'max_accepted_event_timestamp', type: 'integer' })
  maxAcceptedEventTimestamp!: number;

  @Column({ name: 'last_accepted_event_id', type: 'text' })
  lastAcceptedEventId!: string;

  @Column({ name: 'created_at', type: 'text' })
  createdAt!: string;

  @Column({ name: 'updated_at', type: 'text' })
  updatedAt!: string;
}
