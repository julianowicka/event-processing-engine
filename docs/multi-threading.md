# Multi-threading

The MVP is designed for a single local Node.js process and one SQLite database
file. This is appropriate for the recruitment task and keeps the behavior easy
to inspect.

## Current Strategy

- `POST /events` performs ingestion only and returns `QUEUED`.
- `EventWorkerService` processes available jobs in the background.
- Database writes are performed by `SqliteService`.
- The service runs related mutations inside explicit SQLite transactions.
- `raw_incoming_events` is append-only and is not updated by the worker.
- `event_processing_jobs` stores processing status, retry metadata, and latest
  decision pointers.
- Processing order is raw delivery `id ASC`, read through available jobs.

This MVP should not be horizontally scaled without worker claiming. The worker
uses an in-process running guard so two ticks in the same process do not process
the same pending jobs concurrently.

## Future Scaling Path

To scale beyond one local process:

1. Add worker claiming/locking around `event_processing_jobs`.
2. Consider WAL tuning, retryable busy handling, or a broker-backed store.
3. Preserve deduplication through `processed_event_keys`.
4. Keep processing order deterministic per partition/order key.
5. Keep the retry and DLQ policy.

## Idempotency

`processed_event_keys.event_id` is the deduplication guard. The first
structurally valid event claims the key before business rules run. Later raw
deliveries with the same key still get their own processing jobs and are audited
as `DUPLICATE`.
