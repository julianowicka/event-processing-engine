# Multi-threading

Node.js handles requests concurrently, while SQLite allows only one writer at a
time. The engine will make this behavior explicit instead of relying on accidental
timing.

## Concurrency Strategy

- Use one NestJS `TypeOrmModule` DataSource backed by `better-sqlite3`.
- Enable WAL mode and `busy_timeout` during database initialization.
- Keep ingestion transactions short: insert raw deliveries and jobs only.
- Process each job inside a TypeORM transaction.
- Keep transactions short and free from external calls.
- Rely on `processed_event_keys.event_id` for final deduplication under concurrent requests.

## Batch Processing

The API accepts a batch and persists raw deliveries in request order. Business
processing is asynchronous and performed by the worker.

- `POST /events` inserts `raw_incoming_events` rows and `PENDING` jobs.
- The response returns `QUEUED` for each stored raw delivery.
- Business decisions are written later by the worker.

## Parallelism Boundary

One active worker processes jobs in raw delivery order. Horizontal API scaling is
allowed for ingestion, but only one worker instance is enabled for a SQLite
database file. This preserves `raw_incoming_events.id ASC` processing order.

Worker claim order:

```sql
ORDER BY raw_incoming_events.id ASC
```

`event_timestamp` does not define processing order.

## Idempotency

The unique index on `processed_event_keys.event_id` is the final deduplication
guard. Duplicate raw deliveries are still stored in `raw_incoming_events`, but
only the first processed job claims the key. Later jobs create `DUPLICATE` audit
decisions.
