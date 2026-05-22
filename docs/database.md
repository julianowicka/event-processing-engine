# Database

SQLite will be used as the local persistent database. The implementation will use
TypeORM with the `better-sqlite3` driver. TypeORM owns connection management,
entity mapping, migrations, repositories, and transaction helpers. Domain logic,
state transitions, merge decisions, deduplication policy, and audit decisions
remain in application services.

## ORM Scope

TypeORM is used for persistence mechanics only:

- Opening and configuring the SQLite connection.
- Running migrations.
- Mapping tables to entities.
- Providing repositories.
- Executing per-job transactions.

Application services own workflow behavior and business decisions.

## Entities

- `OrderEntity`.
- `RawIncomingEventEntity`.
- `EventProcessingJobEntity`.
- `ProcessedEventKeyEntity`.
- `EventDecisionEntity`.
- `OrderHistoryEntity`.
- `OrderFieldVersionEntity`.
- `ProcessingStatsEntity`.

## Tables

### `orders`

Stores the latest materialized order state for fast `GET /orders/:id`.

Fields:

- `id`: internal primary key.
- `order_id`: external order identifier, unique.
- `status`: current order status.
- `amount_minor`: current order amount in the smallest currency unit.
- `currency`: optional currency code.
- `paid_amount_minor`: total captured amount in the smallest currency unit.
- `refunded_amount_minor`: total refunded amount in the smallest currency unit.
- `version`: incremented after every accepted state change.
- `last_accepted_event_timestamp`: highest timestamp of any accepted or partially applied event that affected order state.
- `last_accepted_event_id`: event that last changed the order.
- `created_at`, `updated_at`.

### `raw_incoming_events`

Stores every raw event delivery received by the API. This table is append-only,
is never updated after insert, and is not used as the processing queue.

Fields:

- `id`: internal primary key.
- `event_id`: external event id, nullable for malformed events.
- `order_id`: nullable for malformed events.
- `type`: nullable for malformed events.
- `event_timestamp`: nullable for malformed events.
- `raw_event_json`: original event item from the request.
- `payload_json`: raw payload when available, nullable.
- `received_at`.

Every delivery is inserted, including duplicates, invalid events, and malformed
items. Duplicate detection is handled by `processed_event_keys`.

### `event_processing_jobs`

Stores asynchronous processing work created from raw event deliveries.

Fields:

- `id`: internal primary key.
- `raw_incoming_event_id`: unique reference to `raw_incoming_events`.
- `status`: `PENDING`, `PROCESSING`, `DONE`, or `FAILED`.
- `attempts`.
- `available_at`.
- `claimed_at`.
- `processed_at`.
- `last_error_message`.
- `created_at`, `updated_at`.

`POST /events` inserts raw events and creates `PENDING` jobs. Workers claim jobs
in raw delivery order using `raw_incoming_events.id ASC`.

### `processed_event_keys`

Stores processed external event ids for fast deduplication.

Fields:

- `event_id`: external event id, unique.
- `first_raw_incoming_event_id`: reference to the first raw delivery that claimed the key.
- `order_id`: nullable when the first delivery has no valid order id.
- `first_seen_at`.

This table allows duplicate deliveries to remain in `raw_incoming_events` while still
making deduplication a cheap indexed lookup. The first delivery with a given
`event_id` claims the key even when the final business decision is `REJECTED`.

### `event_decisions`

Audit log of every engine decision, including duplicates.

Fields:

- `id`: primary key.
- `raw_incoming_event_id`: reference to `raw_incoming_events`.
- `event_id`: nullable external event id.
- `order_id`: nullable external order id.
- `decision`: `ACCEPTED`, `REJECTED`, `PARTIALLY_APPLIED`, `DUPLICATE`, or `FAILED`.
- `reason_code`.
- `reason_message`.
- `details_json`.
- `created_at`.

### `order_history`

Stores accepted state changes and partial applications.

Fields:

- `id`: primary key.
- `order_id`.
- `event_id`.
- `event_timestamp`.
- `processed_at`.
- `from_status`: nullable, set only when status changes.
- `to_status`: nullable, set only when status changes.
- `changed_fields_json`: object with non-status changed field names and new values.
- `created_at`.

### `order_field_versions`

Stores field-level version metadata used by the merge strategy.

Fields:

- `order_id`.
- `field_name`.
- `last_event_timestamp`.
- `last_event_id`.
- `updated_at`.

Primary key: `(order_id, field_name)`.

### `processing_stats`

Stores aggregate counters to make `GET /stats` cheap.

Fields:

- `id`: fixed single-row primary key.
- `valid_events_count`.
- `accepted_events_count`.
- `partially_applied_events_count`.
- `rejected_events_count`.
- `duplicate_events_count`.
- `processed_events_count`.
- `total_processing_time_ms`.
- `updated_at`.

[`GET /stats`](./api-contract.md#get-stats) exposes `validEventsCount`,
`rejectedEventsCount`, `duplicateEventsCount`, and `averageProcessingTimeMs`.
The average is derived by `StatsService` from `total_processing_time_ms` and
`processed_events_count`.

Public counter rules:

- `valid_events_count`: `ACCEPTED` and `PARTIALLY_APPLIED` decisions.
- `accepted_events_count`: `ACCEPTED` decisions.
- `partially_applied_events_count`: `PARTIALLY_APPLIED` decisions.
- `rejected_events_count`: `REJECTED` and `FAILED` decisions.
- `duplicate_events_count`: `DUPLICATE` decisions.
- `processed_events_count`: all decisions included in processing time statistics.

The additional internal counters support diagnostics and tests, but they are not
returned by the public stats contract.

## Indexes

- `orders(order_id)` unique.
- `raw_incoming_events(event_id)`.
- `raw_incoming_events(order_id)`.
- `raw_incoming_events(received_at)`.
- `event_processing_jobs(status, available_at)`.
- `event_processing_jobs(raw_incoming_event_id)` unique.
- `processed_event_keys(event_id)` unique.
- `event_decisions(event_id)`.
- `event_decisions(order_id)`.
- `event_decisions(raw_incoming_event_id)`.
- `order_history(order_id, created_at)`.
- `order_history(event_id)`.
- `order_field_versions(order_id, field_name)` unique.

## Performance Notes

Current order reads are fast because `orders` is a materialized state table keyed
by `order_id`. History and audit reads are bounded by indexed `order_id` lookups.
Ingestion writes are cheap append-only inserts. Processing writes are heavier
because accepted events update multiple tables, but each job runs inside a short
SQLite transaction.

## Transaction Boundary

`POST /events` writes raw deliveries and jobs inside an ingestion transaction.
Business processing happens later. Each job is processed inside its own SQLite
transaction, so failed, duplicate, rejected, and accepted events do not roll back
other jobs.
