# Multi-threading

The MVP is designed for a single local Node.js process and one SQLite database
file. This is appropriate for the recruitment task and keeps the behavior easy
to inspect.

## Target Strategy

- `POST /events` performs ingestion only and returns stored delivery ids.
- `EventWorkerService` processes available deliveries in the background.
- Database writes are performed by `SqliteService`.
- The service runs related mutations inside explicit SQLite transactions.
- `raw_incoming_events.raw_event_json` is immutable after ingestion.
- `raw_incoming_events` also stores processing status, retry metadata, and
  availability time.
- Processing order is raw delivery `id ASC`.

This MVP should not be horizontally scaled without worker claiming. The worker
uses an in-process running guard so two ticks in the same process do not process
the same pending deliveries concurrently.

## Future Scaling Path

To scale beyond one local process:

1. Add worker claiming/locking fields to the durable inbox lifecycle.
2. Consider WAL tuning, retryable busy handling, or a broker-backed store.
3. Preserve deduplication through `processed_event_keys`.
4. Keep processing order deterministic per partition/order key.
5. Keep the retry policy and final failure auditing.

## Idempotency

`processed_event_keys.event_id` is the deduplication guard. The first
structurally valid event claims the key before business rules run. Later raw
deliveries with the same key still get their own audit outcomes as
`DUPLICATE`.
