import { Check, Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('stats')
@Check('chk_stats_singleton', 'id = 1')
export class EngineStatsEntity {
  @PrimaryColumn({ type: 'integer' })
  id!: number;

  @Column({ name: 'valid_events_count', type: 'integer', default: 0 })
  validEventsCount!: number;

  @Column({ name: 'rejected_events_count', type: 'integer', default: 0 })
  rejectedEventsCount!: number;

  @Column({ name: 'duplicate_events_count', type: 'integer', default: 0 })
  duplicateEventsCount!: number;

  @Column({ name: 'processed_events_count', type: 'integer', default: 0 })
  processedEventsCount!: number;

  @Column({ name: 'total_processing_time_ms', type: 'integer', default: 0 })
  totalProcessingTimeMs!: number;

  @Column({ name: 'updated_at', type: 'text' })
  updatedAt!: string;
}
