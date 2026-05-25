export interface StatsRow {
  valid_events_count: number;
  rejected_events_count: number;
  duplicate_events_count: number;
  processed_events_count: number;
  total_processing_time_ms: number;
  updated_at: string;
}

export interface EngineStats {
  validEventsCount: number;
  rejectedEventsCount: number;
  duplicateEventsCount: number;
  averageProcessingTimeMs: number;
}
