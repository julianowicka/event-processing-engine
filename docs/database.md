# Database

The MVP uses a local SQLite database file as the persistence layer.

Default path:

- `data/app.sqlite`

Override:

- `SQLITE_DB_PATH=/absolute/path/database.sqlite`

## Persistence Boundary

The database file is managed by `SqliteService`. The service owns the SQLite
connection, enables foreign keys, configures local durability settings, and
exposes a narrow persistence boundary for the rest of the application.

- Open or create the configured SQLite file during application startup.
- Run schema initialization with idempotent DDL.
- Execute related domain mutations inside explicit SQLite transactions.
- Commit only when the mutation succeeds.
- Roll back the transaction on unexpected errors.

The domain logic should stay independent from storage mechanics. State-machine
rules, merge rules, worker retry policy, and API contracts should be expressed
in services, while SQL details stay inside the persistence layer.




## Inbox Model

Raw delivery storage and processing state are separated.

- `raw_incoming_events` is an insert-only inbox log. It stores every raw delivery
  received by `POST /events`, including malformed items and duplicate
  deliveries. The worker must not update this table.
- `event_processing_jobs` is the technical queue and lifecycle table. It stores
  processing status, retry metadata, next availability time, and the latest
  decision pointer for each raw delivery.
- `processed_event_keys` is the deduplication source of truth.
- `event_decisions` is the audit log of explicit engine decisions.
- `orders`, `order_history`, `order_field_versions`, `stats`, and
  `dead_letter_events` keep their domain responsibilities.

This separation keeps the inbox auditable and immutable while allowing the
worker to update job state as processing progresses.

## Tables

Table names intentionally mirror the domain concepts used by the engine. Raw
event snapshots, payload snapshots, changed fields, skipped fields, and decision
details are stored in `TEXT` columns containing serialized request data.

### `raw_incoming_events`

Append-only raw deliveries received by `POST /events`.

Important fields:

- `id`: integer primary key, internal incoming delivery id.
- `event_id`, `order_id`, `type`, `event_timestamp`: extracted convenience
  fields, nullable for malformed items.
- `raw_event_json`: original event item serialized as text.
- `payload_json`: extracted payload serialized as text when it is an object.
- `received_at`: timestamp when the delivery was stored.

This table has no processing status, retry counters, availability timestamp, or
latest decision fields. A raw delivery row is inserted once and never updated by
the worker.

Recommended indexes:

- `idx_raw_incoming_events_order_id` on `order_id`.
- `idx_raw_incoming_events_event_id` on `event_id`.

### `event_processing_jobs`

Technical processing queue/status table. Every row references exactly one raw
delivery.

Important fields:

- `id`: integer primary key, internal job id.
- `raw_incoming_event_id`: unique reference to `raw_incoming_events.id`.
- `status`: `PENDING`, `DEFERRED`, `DONE`, or `DEAD_LETTERED`.
- `available_at`: earliest time the worker may process or retry the job.
- `attempts`: technical failure attempts.
- `last_error_message`: last unexpected worker error, if any.
- `last_decision_id`: latest audit decision id for this job, if any.
- `last_reason_code`: latest reason code for this job, if any.
- `created_at`, `updated_at`: technical lifecycle timestamps.

The worker reads and updates this table. It joins to `raw_incoming_events` when
it needs the original delivery payload or extracted metadata.

Recommended indexes:

- `idx_event_processing_jobs_status_available_id` on
  `(status, available_at, id)`.
- `idx_event_processing_jobs_raw_incoming_event_id` on
  `raw_incoming_event_id`.

### `processed_event_keys`

Deduplication keys by external `event_id`.

The first raw delivery with a structurally valid event claims the key before
business rules run. Later deliveries with the same `event_id` become
`DUPLICATE`, even if the first delivery is later rejected by a business rule or
deferred until the order exists.

Important fields:

- `event_id`: primary key.
- `first_raw_incoming_event_id`: references `raw_incoming_events.id`.
- `order_id`: nullable extracted order id.
- `first_seen_at`: timestamp when the key was claimed.

### `orders`

Materialized current order state.

Important fields:

- `order_id`: primary key.
- `status`
- `amount_minor`
- `currency`
- `paid_amount_minor`
- `refunded_amount_minor`
- `version`
- `max_accepted_event_timestamp`
- `last_accepted_event_id`
- `created_at`, `updated_at`

`max_accepted_event_timestamp` is the highest timestamp of an accepted or
partially applied event. It is not used as the only conflict rule; field-level
versions are used for set-like fields.

### `order_field_versions`

Per-field timestamp metadata for fields that behave as last-write-wins values:

- `status`
- `amountMinor`
- `currency`
- `paidAmountMinor`
- `refundedAmountMinor`

Set-like fields apply only when the incoming event timestamp is strictly newer
than the field version. Equal timestamps keep the first accepted value.

Important fields:

- `order_id`: references `orders.order_id`.
- `field_name`
- `last_event_timestamp`
- `last_event_id`
- `updated_at`

The primary key is `(order_id, field_name)`.

### `order_history`

Accepted and partially applied state changes. Each entry stores:

- source event id/type/timestamp,
- status transition,
- changed fields,
- skipped obsolete fields,
- final decision and reason code.

Important fields:

- `id`: integer primary key.
- `order_id`
- `event_id`, `event_type`, `event_timestamp`
- `processed_at`
- `from_status`, `to_status`
- `changed_fields_json`
- `skipped_fields_json`
- `decision`, `reason_code`
- `created_at`

### `event_decisions`

Audit log of every explicit engine decision:

- `ACCEPTED`
- `PARTIALLY_APPLIED`
- `REJECTED`
- `DUPLICATE`
- `DEFERRED`
- `FAILED`

This is the source for `GET /orders/:id` rejected events, pending jobs, and
audit log. A job can have more than one decision over time, for example one or
more `DEFERRED` decisions followed by a final `ACCEPTED` or `REJECTED` decision.

Important fields:

- `id`: integer primary key.
- `raw_incoming_event_id`: references `raw_incoming_events.id`.
- `event_processing_job_id`: references `event_processing_jobs.id`.
- `event_id`, `order_id`, `type`, `timestamp`
- `decision`, `reason_code`, `reason_message`
- `details_json`
- `processing_time_ms`
- `created_at`

Recommended indexes:

- `idx_event_decisions_order_id` on `order_id`.
- `idx_event_decisions_raw_incoming_event_id` on `raw_incoming_event_id`.
- `idx_event_decisions_job_id` on `event_processing_job_id`.

### `stats`

Aggregate counters for `GET /stats`:

- `valid_events_count`: accepted + partially applied.
- `accepted_events_count`
- `partially_applied_events_count`
- `rejected_events_count`
- `duplicate_events_count`
- `processed_events_count`
- `total_processing_time_ms`
- `updated_at`

Deferred jobs are intentionally not counted as rejected. Dead-lettered technical
failures are counted as rejected only when the job reaches the retry limit and a
final `FAILED` decision is written.

The MVP stores stats as a single row with `id = 1`. Diagnostic counts such as
pending jobs and dead-lettered jobs can be derived from `event_processing_jobs`
and `dead_letter_events`.

### `dead_letter_events`

Technical failures that exceeded the retry limit. Each entry stores:

- processing job id,
- raw incoming event id,
- raw event snapshot,
- error message,
- reason code,
- attempt count,
- created timestamp.

Business rejections stay in `event_decisions`, not in the dead-letter queue.

## Schema Initialization

The application creates missing tables and indexes on startup. Schema
initialization is idempotent, using `CREATE TABLE IF NOT EXISTS` and
`CREATE INDEX IF NOT EXISTS`.

The initial schema also inserts the single stats row if it does not exist.
Future schema changes should be additive and explicit rather than inferred from
runtime data.

## Initial SQL Skeleton

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

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
    status IN ('PENDING', 'DEFERRED', 'DONE', 'DEAD_LETTERED')
  ),
  available_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error_message TEXT,
  last_decision_id INTEGER,
  last_reason_code TEXT,
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
    status IN (
      'CREATED',
      'PAID',
      'CANCELLED',
      'PARTIALLY_REFUNDED',
      'REFUNDED'
    )
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
  decision TEXT NOT NULL CHECK (decision IN ('ACCEPTED', 'PARTIALLY_APPLIED')),
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
    decision IN (
      'ACCEPTED',
      'PARTIALLY_APPLIED',
      'REJECTED',
      'DUPLICATE',
      'DEFERRED',
      'FAILED'
    )
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
  reason_code TEXT NOT NULL CHECK (reason_code = 'PROCESSING_ERROR'),
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
```
