import { Check, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type {
  EngineDecision,
  OrderStatus,
  ReasonCode,
} from '../../events/types/event.types';

@Entity('event_decisions')
@Check(
  'chk_event_decisions_decision',
  "decision IN ('ACCEPTED', 'PARTIALLY_APPLIED', 'REJECTED', 'DUPLICATE', 'FAILED')",
)
@Index('idx_event_decisions_created', ['createdAt', 'id'])
export class EventDecisionEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'raw_incoming_event_id', type: 'integer', unique: true })
  rawIncomingEventId!: number;

  @Column({ type: 'text' })
  decision!: EngineDecision;

  @Column({ name: 'reason_code', type: 'text' })
  reasonCode!: ReasonCode;

  @Column({ name: 'reason_message', type: 'text' })
  reasonMessage!: string;

  @Column({ name: 'from_status', type: 'text', nullable: true })
  fromStatus!: OrderStatus | null;

  @Column({ name: 'to_status', type: 'text', nullable: true })
  toStatus!: OrderStatus | null;

  @Column({ name: 'changed_fields_json', type: 'text', default: '{}' })
  changedFieldsJson!: string;

  @Column({ name: 'skipped_fields_json', type: 'text', default: '{}' })
  skippedFieldsJson!: string;

  @Column({ name: 'processing_time_ms', type: 'integer', default: 0 })
  processingTimeMs!: number;

  @Column({ name: 'created_at', type: 'text' })
  createdAt!: string;
}
