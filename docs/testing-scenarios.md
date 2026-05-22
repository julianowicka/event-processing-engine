# Testing Scenarios

Testing will cover the engine at unit, integration, and performance levels.

## Unit Tests

Focus areas:

- Event validation.
- Deduplication decision.
- State pattern transitions.
- Field-level merge decisions.
- Partial update behavior.
- Reason code mapping.

## Integration Tests

Focus areas:

- `POST /events` queues mixed batches and preserves raw delivery order.
- Worker processes jobs by `raw_incoming_events.id ASC`.
- Malformed items are stored as raw deliveries and rejected by the worker.
- `GET /orders/:id` returns current state, history, and rejected events.
- `GET /stats` returns valid counters and average processing time.
- SQLite transactions commit jobs independently.
- Duplicate event handling works under repeated requests.

## Performance Tests

Focus areas:

- Large batch processing time.
- Worker batch processing time.
- Many events for the same order.
- Many events for different orders.
- Repeated duplicate submissions.
- Query speed for order state and history.

## Critical Scenarios

- Create order, update amount in minor units, capture payment.
- Duplicate `ORDER_CREATED`.
- Out-of-order amount update.
- Cancel order, then receive payment.
- Paid order receives partial refund.
- Paid order receives full refund.
- Batch contains valid, invalid, malformed, duplicate, and rejected events.
- `POST /events` returns `QUEUED` before worker decisions exist.

## Quality Gate

Before finishing the implementation:

- Unit tests pass.
- Integration tests pass.
- Performance test has a documented baseline.
- Coverage includes ingestion, worker processing, state transitions, and merge conflicts.
