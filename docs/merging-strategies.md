# Merging Strategies

Events can arrive late, out of order, or with partial payloads. The engine will
use a field-level merge strategy instead of rejecting every older event.

## Main Rule

An event field is applied only when its event timestamp is greater than or equal
to the last timestamp stored for that specific field.

Metadata is stored in `order_field_versions`.

Example:

- `amount_minor` last changed at timestamp `1710002000`.
- A late event with timestamp `1710001000` contains `amount_minor`.
- The `amount_minor` update is rejected as obsolete.

## Partial Application

If an older event contains multiple fields, only obsolete fields are skipped.
Fields that were not changed by newer events can still be applied.

Possible result:

- Decision: `PARTIALLY_APPLIED`.
- Audit reason: `PARTIAL_MERGE`.
- History contains only the applied fields.

## Missing Fields

Missing payload fields never erase existing state. The engine updates only fields
explicitly present in the payload.

## Status Changes

Status changes are handled by the State pattern first. A status field is merged
only if:

- The transition is allowed from the current state.
- The status field is not obsolete.

## Tie-Breaker

If two events for the same field have the same timestamp, the first accepted event
wins. The second event is rejected for that field unless it is a duplicate by
`eventId`.

## Money Fields

Money is stored and merged as integer minor units:

- `amount_minor`.
- `paid_amount_minor`.
- `refunded_amount_minor`.

The API accepts decimal money fields, such as `amount`, and the processing layer
maps them to internal minor-unit fields before merge.

## Why This Strategy

This approach gives predictable behavior, keeps old useful data from being lost,
and allows the API to explain exactly why each field was applied or skipped.
