# Database

The MVP uses a JSON file on disk instead of SQLite or an ORM. This keeps the
submission small, inspectable, and aligned with the task allowance: "baza danych
w postaci pliku JSON na dysku".

Default path:

- `data/events-db.json`

Override:

- `EVENT_ENGINE_DB_FILE=/absolute/path/database.json`

## Persistence Boundary

The file is managed by `JsonDatabaseService`. The service provides a small
transaction-like API:

- Load the current JSON file.
- Clone it into a working copy.
- Run the domain mutation.
- Write the full file back only when the mutation succeeds.

This is enough for the local single-process recruitment app. It also keeps the
domain logic independent from storage, so replacing the JSON file with SQLite
later would not require rewriting the state machine.

## Collections

### `rawIncomingEvents`

Append-only raw deliveries received by `POST /events`.

Important fields:

- `id`: internal incoming delivery id.
- `eventId`, `orderId`, `type`, `eventTimestamp`: extracted convenience fields,
  nullable for malformed items.
- `rawEvent`: original JSON item.
- `payload`: extracted payload when it is an object.
- `availableAt`: earliest time the worker may retry this delivery.
- `processingStatus`: `PENDING`, `DEFERRED`, `DONE`, or `DEAD_LETTERED`.
- `attempts`: technical failure attempts.
- `lastErrorMessage`: last unexpected worker error, if any.
- `lastDecisionId`, `lastReasonCode`: latest engine decision for the delivery.

### `processedEventKeys`

Deduplication keys by external `eventId`.

The first raw delivery with a structurally valid event claims the key before
business rules run. That means later deliveries with the same `eventId` become
`DUPLICATE`, even if the first delivery is later rejected by a business rule or
deferred until the order exists.

### `orders`

Materialized current order state.

Important fields:

- `orderId`
- `status`
- `amountMinor`
- `currency`
- `paidAmountMinor`
- `refundedAmountMinor`
- `version`
- `maxAcceptedEventTimestamp`
- `lastAcceptedEventId`
- `createdAt`, `updatedAt`

`maxAcceptedEventTimestamp` is the highest timestamp of an accepted or partially
applied event. It is not used as the only conflict rule; field-level versions are
used for set-like fields.

### `orderFieldVersions`

Per-field timestamp metadata for fields that behave as last-write-wins values:

- `status`
- `amountMinor`
- `currency`
- `paidAmountMinor`
- `refundedAmountMinor`

Set-like fields apply only when the incoming event timestamp is strictly newer
than the field version. Equal timestamps keep the first accepted value.

### `orderHistory`

Accepted and partially applied state changes. Each entry stores:

- source event id/type/timestamp,
- status transition,
- changed fields,
- skipped obsolete fields,
- final decision and reason code.

### `eventDecisions`

Audit log of every explicit engine decision:

- `ACCEPTED`
- `PARTIALLY_APPLIED`
- `REJECTED`
- `DUPLICATE`
- `DEFERRED`
- `FAILED`

This is the source for `GET /orders/:id` rejected events, pending events, and
audit log.

### `stats`

Aggregate counters for `GET /stats`:

- `validEventsCount`: accepted + partially applied.
- `acceptedEventsCount`
- `partiallyAppliedEventsCount`
- `rejectedEventsCount`
- `duplicateEventsCount`
- `processedEventsCount`
- `totalProcessingTimeMs`

Deferred events are intentionally not counted as rejected. Dead-lettered
technical failures are counted as rejected.

### `deadLetterEvents`

Technical failures that exceeded the retry limit. Each entry stores:

- raw incoming event id,
- raw event snapshot,
- error message,
- reason code,
- attempt count,
- created timestamp.

Business rejections should stay in `eventDecisions`, not in the dead-letter
queue.
