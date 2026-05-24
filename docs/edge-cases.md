# Edge Cases

Every important engine decision is written to the audit log.

## Duplicate Event

Same `eventId` appears again.

Decision: `DUPLICATE`.

Action: store the raw delivery, create a processing job, skip state changes,
write a `DUPLICATE` audit decision, and mark the job as `DONE`.

## Unknown Event Type

Event type is not supported.

Decision: `REJECTED`.

Action: store the raw delivery, create a processing job, and write
`UNKNOWN_EVENT_TYPE`.

## Event Before Create

An update, payment, cancellation, or refund arrives for an unknown order.

Decision: `DEFERRED`.

Action: keep the processing job deferred with reason `ORDER_NOT_READY`. It is
retried after future ingestions. This avoids permanently losing valid
out-of-order events.

## Create After Deferred Event

If an `ORDER_CREATED` event later creates the order, phase 2 retries deferred
jobs. In a single batch this can happen inside the same `POST /events` call.

## Cancelled Order Receives Payment

`PAYMENT_CAPTURED` arrives after cancellation.

Decision: `REJECTED`.

Action: preserve `CANCELLED` state and audit `FORBIDDEN_TRANSITION`.

## Refund Before Payment

`REFUND_ISSUED` arrives before captured payment.

Decision: `DEFERRED` if the order does not exist yet, or if a matching
`PAYMENT_CAPTURED` job for the order is still pending. Otherwise `REJECTED`
when the order exists but no payment can still make the refund valid.

Action: do not change order state.

## Partial Refund

Refund total is lower than captured payment.

Decision: `ACCEPTED`.

Action: status becomes `PARTIALLY_REFUNDED`.

## Full Refund

Refund total equals captured payment.

Decision: `ACCEPTED`.

Action: status becomes `REFUNDED`.

## Refund Exceeds Payment

Refund total would exceed captured payment.

Decision: `REJECTED`.

Action: preserve current state and audit `REFUND_EXCEEDS_CAPTURED`.

## Late Partial Payload

Older event contains multiple fields.

Decision: `PARTIALLY_APPLIED` when at least one field is still useful.

Action: apply non-obsolete fields and skip obsolete fields.

## Conflicting Amount

Two accepted events set different order amounts.

Decision: strictly newer timestamp wins for `amountMinor`. Same timestamp keeps
the first accepted value.
