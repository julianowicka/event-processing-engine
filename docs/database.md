# Database - Simplified Target Design

This document describes the persistence model used by the application.

The target keeps the valuable parts of the existing design:

- ingestion and processing happen separately;
- every raw delivery remains available;
- audit decisions are explicit;
- statistics are stored for fast reads;
- stale partial updates can be merged per field;
- exhausted technical failures are visible as final failed decisions.

It removes tables and columns that are not needed to demonstrate those
requirements.

## Persistence Boundary

The application uses a local SQLite database file.

Default path:

- `data/app.sqlite`

Override:

- `SQLITE_DB_PATH=/absolute/path/database.sqlite`

The persistence layer:

- creates or upgrades a database through TypeORM migrations at startup;
- append deliveries during `POST /events`;
- process pending deliveries later in a worker;
- wrap one processing outcome, including state, audit, and stats updates, in a
  transaction.

## Target Schema

The target schema has six tables:

| Table | Responsibility |
| --- | --- |
| `raw_incoming_events` | Raw inbox plus minimal processing lifecycle and retry state |
| `processed_event_keys` | Unique deduplication claims |
| `orders` | Current materialized order state |
| `order_field_versions` | Field-level timestamp metadata for stale-event merging |
| `event_decisions` | Explicit audit log and history source |
| `stats` | Precomputed counters for fast `GET /stats` |

The raw event content remains immutable after insertion. Only its technical
processing fields are updated by the worker. This is sufficient for a small
single-worker application. Order history is queried from applied
`event_decisions`, so no separate history table is required.

## Tables

### `raw_incoming_events`

Stores each received item, including malformed items and duplicate deliveries.
It is also the small durable queue for the background worker.

Fields:

- `id`: internal delivery id.
- `event_id`, `order_id`, `type`, `event_timestamp`: nullable projections used
  for querying and audit presentation.
- `raw_event_json`: original input item; never modified after insertion.
- `received_at`: insertion timestamp.
- `processing_status`: `PENDING`, `RETRY`, or `DONE`.
- `available_at`: when a pending or retryable item may be processed.
- `attempts`: number of unexpected technical failures.
- `last_error_message`: most recent unexpected technical error.

Fields removed from the current model:

- `payload_json`: the worker can parse the payload from `raw_event_json`.
- work-item ids, lock ownership, and latest-decision pointers: unnecessary for the
  single-worker recruitment-task scope.
- additional lifecycle timestamps: `received_at` and decision timestamps
  already cover the observable lifecycle.

The worker changes only `processing_status`, `available_at`, `attempts`, and
`last_error_message`.

### `processed_event_keys`

Reserves a structurally valid external `eventId` before business rules run.
Later deliveries with that `eventId` become `DUPLICATE`, even when the original
delivery is later rejected by a transition rule.

Fields:

- `event_id`: primary key.
- `first_raw_incoming_event_id`: the delivery that claimed the key.

Fields removed:

- `order_id`: available through the referenced raw delivery.
- `first_seen_at`: available as the referenced delivery's `received_at`.

### `orders`

Stores only the current state needed by the business endpoints and transition
rules.

Fields:

- `order_id`: primary key.
- `status`.
- `amount_minor`.
- `currency`.
- `paid_amount_minor`.
- `refunded_amount_minor`.
- `created_at`, `updated_at`.

Fields removed:

- `version`: not required by the assignment or API.
- `max_accepted_event_timestamp`: field ordering belongs to
  `order_field_versions`.
- `last_accepted_event_id`: accepted actions are traceable through
  `event_decisions`.

### `order_field_versions`

Keeps the timestamp metadata needed for ordering:

- `status`
- `amountMinor`
- `currency`

`amountMinor` and `currency` are set-like partial-update fields. `status`
records the timestamp of status changes made by lifecycle events; it is not
changed by `ORDER_UPDATED`. Payment and refund amounts are handled as business
operations and are not generic last-write-wins payload fields.

Fields:

- `order_id`.
- `field_name`.
- `last_event_timestamp`.
- `last_event_id`.

The primary key is `(order_id, field_name)`. If an incoming event has an older
or equal timestamp for one of these fields, that field is skipped while newer
fields from the same event may still be applied.

Field removed:

- `updated_at`: the applied decision already provides audit timing.

### `event_decisions`

Explicit audit log of final engine decisions:

- `ACCEPTED`
- `PARTIALLY_APPLIED`
- `REJECTED`
- `DUPLICATE`
- `FAILED`

Each raw delivery receives at most one final decision. Technical retries do not
create decisions; they update retry metadata until processing succeeds or
exhausts the limit.

The table also supplies order history. `ACCEPTED` and `PARTIALLY_APPLIED` rows
with `changed_fields_json` are returned as history entries by joining the raw
delivery for event metadata.

Fields:

- `id`.
- `raw_incoming_event_id`: unique reference to the processed delivery.
- `decision`, `reason_code`, `reason_message`.
- `from_status`, `to_status`: populated when an order state was applied.
- `changed_fields_json`, `skipped_fields_json`: field-level history and merge
  explanation.
- `processing_time_ms`.
- `created_at`.

Fields deliberately omitted:

- `event_id`, `order_id`, `type`, `timestamp`: available by joining the raw
  delivery.
- `details_json`: reason and changed/skipped fields cover the required audit
  output.

### `stats`

Stores one aggregate row so `GET /stats` is constant-time and does not scan the
audit log.

Fields:

- `id`, fixed to `1`.
- `valid_events_count`: accepted plus partially applied.
- `rejected_events_count`: rejected plus failed.
- `duplicate_events_count`.
- `processed_events_count`: final decisions only.
- `total_processing_time_ms`.
- `updated_at`.

Fields removed:

- `accepted_events_count` and `partially_applied_events_count`: not required by
  the recruitment-task API.

The response calculates average time as
`total_processing_time_ms / processed_events_count`.

When the technical retry limit is reached, one transaction marks the delivery
`DONE`, writes a final `FAILED` audit decision with reason
`PROCESSING_ERROR`, and increments rejected and processed statistics.

## Target SQL Skeleton

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
  received_at TEXT NOT NULL,
  processing_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
    processing_status IN ('PENDING', 'RETRY', 'DONE')
  ),
  available_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error_message TEXT
);

CREATE TABLE IF NOT EXISTS processed_event_keys (
  event_id TEXT PRIMARY KEY,
  first_raw_incoming_event_id INTEGER NOT NULL,
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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_field_versions (
  order_id TEXT NOT NULL,
  field_name TEXT NOT NULL CHECK (
    field_name IN ('status', 'amountMinor', 'currency')
  ),
  last_event_timestamp INTEGER NOT NULL,
  last_event_id TEXT NOT NULL,
  PRIMARY KEY (order_id, field_name),
  FOREIGN KEY (order_id) REFERENCES orders(order_id)
);

CREATE TABLE IF NOT EXISTS event_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_incoming_event_id INTEGER NOT NULL UNIQUE,
  decision TEXT NOT NULL CHECK (
    decision IN (
      'ACCEPTED',
      'PARTIALLY_APPLIED',
      'REJECTED',
      'DUPLICATE',
      'FAILED'
    )
  ),
  reason_code TEXT NOT NULL,
  reason_message TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  changed_fields_json TEXT NOT NULL DEFAULT '{}',
  skipped_fields_json TEXT NOT NULL DEFAULT '{}',
  processing_time_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (raw_incoming_event_id) REFERENCES raw_incoming_events(id)
);

CREATE TABLE IF NOT EXISTS stats (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  valid_events_count INTEGER NOT NULL DEFAULT 0,
  rejected_events_count INTEGER NOT NULL DEFAULT 0,
  duplicate_events_count INTEGER NOT NULL DEFAULT 0,
  processed_events_count INTEGER NOT NULL DEFAULT 0,
  total_processing_time_ms INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_raw_processing_queue
  ON raw_incoming_events (processing_status, available_at, id);

CREATE INDEX IF NOT EXISTS idx_raw_order_id
  ON raw_incoming_events (order_id, id);

CREATE INDEX IF NOT EXISTS idx_raw_event_id
  ON raw_incoming_events (event_id, id);

CREATE INDEX IF NOT EXISTS idx_event_decisions_created
  ON event_decisions (created_at, id);

INSERT OR IGNORE INTO stats (id, updated_at)
  VALUES (1, datetime('now'));
```

## Scope Trade-Offs

This target intentionally assumes one background worker. Multi-worker claim
locking would require additional lifecycle columns or another durable claiming
mechanism.

An event that requires an order before an `ORDER_CREATED` event has been applied
is retried 10 seconds later and rejected after three unsuccessful processing
attempts. Out-of-order partial updates for an existing order still use
field-level merge rules through `order_field_versions`.
