import {
  EngineDecision,
  JobStatus,
  OrderStatus,
  ReasonCode,
} from '../events/event.types';

const sqlStringList = (values: readonly string[]): string =>
  values.map((value) => `'${value}'`).join(', ');

export const databaseSchemaSql = `
CREATE TABLE IF NOT EXISTS raw_incoming_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT,
  order_id TEXT,
  type TEXT,
  event_timestamp INTEGER,
  raw_event_json TEXT NOT NULL,
  payload_json TEXT,
  received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS event_processing_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_incoming_event_id INTEGER NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (
    status IN (${sqlStringList(Object.values(JobStatus))})
  ),
  available_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error_message TEXT,
  last_decision_id INTEGER,
  last_reason_code TEXT,
  locked_by TEXT,
  locked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (raw_incoming_event_id) REFERENCES raw_incoming_events(id)
);

CREATE TABLE IF NOT EXISTS processed_event_keys (
  event_id TEXT PRIMARY KEY,
  first_raw_incoming_event_id INTEGER NOT NULL,
  order_id TEXT,
  first_seen_at TEXT NOT NULL,
  FOREIGN KEY (first_raw_incoming_event_id) REFERENCES raw_incoming_events(id)
);

CREATE TABLE IF NOT EXISTS orders (
  order_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (
    status IN (${sqlStringList(Object.values(OrderStatus))})
  ),
  amount_minor INTEGER,
  currency TEXT,
  paid_amount_minor INTEGER NOT NULL DEFAULT 0,
  refunded_amount_minor INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  max_accepted_event_timestamp INTEGER NOT NULL,
  last_accepted_event_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_field_versions (
  order_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  last_event_timestamp INTEGER NOT NULL,
  last_event_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (order_id, field_name),
  FOREIGN KEY (order_id) REFERENCES orders(order_id)
);

CREATE TABLE IF NOT EXISTS order_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_timestamp INTEGER NOT NULL,
  processed_at TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  changed_fields_json TEXT NOT NULL DEFAULT '{}',
  skipped_fields_json TEXT NOT NULL DEFAULT '{}',
  decision TEXT NOT NULL CHECK (
    decision IN (${sqlStringList([
      EngineDecision.Accepted,
      EngineDecision.PartiallyApplied,
    ])})
  ),
  reason_code TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(order_id)
);

CREATE TABLE IF NOT EXISTS event_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_incoming_event_id INTEGER NOT NULL,
  event_processing_job_id INTEGER NOT NULL,
  event_id TEXT,
  order_id TEXT,
  type TEXT,
  timestamp INTEGER,
  decision TEXT NOT NULL CHECK (
    decision IN (${sqlStringList(Object.values(EngineDecision))})
  ),
  reason_code TEXT NOT NULL,
  reason_message TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  processing_time_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (raw_incoming_event_id) REFERENCES raw_incoming_events(id),
  FOREIGN KEY (event_processing_job_id) REFERENCES event_processing_jobs(id)
);

CREATE TABLE IF NOT EXISTS stats (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  valid_events_count INTEGER NOT NULL DEFAULT 0,
  accepted_events_count INTEGER NOT NULL DEFAULT 0,
  partially_applied_events_count INTEGER NOT NULL DEFAULT 0,
  rejected_events_count INTEGER NOT NULL DEFAULT 0,
  duplicate_events_count INTEGER NOT NULL DEFAULT 0,
  processed_events_count INTEGER NOT NULL DEFAULT 0,
  total_processing_time_ms INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dead_letter_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_processing_job_id INTEGER NOT NULL,
  raw_incoming_event_id INTEGER NOT NULL,
  event_id TEXT,
  order_id TEXT,
  type TEXT,
  timestamp INTEGER,
  raw_event_json TEXT NOT NULL,
  reason_code TEXT NOT NULL CHECK (
    reason_code = '${ReasonCode.ProcessingError}'
  ),
  error_message TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (event_processing_job_id) REFERENCES event_processing_jobs(id),
  FOREIGN KEY (raw_incoming_event_id) REFERENCES raw_incoming_events(id)
);

CREATE INDEX IF NOT EXISTS idx_raw_incoming_events_order_id
  ON raw_incoming_events (order_id);

CREATE INDEX IF NOT EXISTS idx_raw_incoming_events_event_id
  ON raw_incoming_events (event_id);

CREATE INDEX IF NOT EXISTS idx_event_processing_jobs_status_available_id
  ON event_processing_jobs (status, available_at, id);

CREATE INDEX IF NOT EXISTS idx_event_processing_jobs_raw_incoming_event_id
  ON event_processing_jobs (raw_incoming_event_id);

CREATE INDEX IF NOT EXISTS idx_processed_event_keys_order_id
  ON processed_event_keys (order_id);

CREATE INDEX IF NOT EXISTS idx_order_history_order_id
  ON order_history (order_id, id);

CREATE INDEX IF NOT EXISTS idx_event_decisions_order_id
  ON event_decisions (order_id, id);

CREATE INDEX IF NOT EXISTS idx_event_decisions_raw_incoming_event_id
  ON event_decisions (raw_incoming_event_id);

CREATE INDEX IF NOT EXISTS idx_event_decisions_job_id
  ON event_decisions (event_processing_job_id);

CREATE INDEX IF NOT EXISTS idx_dead_letter_events_raw_incoming_event_id
  ON dead_letter_events (raw_incoming_event_id);

CREATE INDEX IF NOT EXISTS idx_dead_letter_events_job_id
  ON dead_letter_events (event_processing_job_id);

INSERT OR IGNORE INTO stats (id, updated_at)
  VALUES (1, datetime('now'));
`;
