export interface StatsRow {
  valid_events_count: number;
  accepted_events_count: number;
  partially_applied_events_count: number;
  rejected_events_count: number;
  duplicate_events_count: number;
  processed_events_count: number;
  total_processing_time_ms: number;
  updated_at: string;
}

export interface EngineStats {
  validEventsCount: number;
  acceptedEventsCount: number;
  partiallyAppliedEventsCount: number;
  rejectedEventsCount: number;
  duplicateEventsCount: number;
  processedEventsCount: number;
  averageProcessingTimeMs: number;
  pendingEventsCount: number;
  queuedJobsCount: number;
  rawDeliveriesCount: number;
  deadLetterEventsCount: number;
  updatedAt: string;
}
