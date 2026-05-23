# Multi-threading

The MVP is designed for a single local Node.js process and one JSON database
file. This is appropriate for the recruitment task and keeps the behavior easy
to inspect.

## Current Strategy

- `POST /events` performs ingestion only and returns `QUEUED`.
- `EventWorkerService` processes available deliveries in the background.
- File writes are performed by `JsonDatabaseService`.
- The service loads the current file, mutates a working copy, and writes it back
  after successful completion.
- Processing order is raw delivery `id ASC`.

Because file-based persistence is not a multi-writer database, this MVP should
not be horizontally scaled. The worker uses an in-process running guard so two
ticks do not process the same JSON file concurrently.

## Future Scaling Path

To scale beyond one local process:

1. Move from JSON file persistence to SQLite or a broker-backed store.
2. Add worker claiming/locking.
3. Preserve deduplication through `processedEventKeys`.
4. Keep processing order deterministic per partition/order key.
5. Keep the retry and DLQ policy.

## Idempotency

`processedEventKeys.eventId` is the deduplication guard. The first structurally
valid event claims the key before business rules run. Later raw deliveries with
the same key are audited as `DUPLICATE`.
