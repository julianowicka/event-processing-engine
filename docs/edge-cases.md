# Edge Cases

Every important engine decision is written to the audit log.

## Duplicate Event

Same `eventId` appears again.

Decision: `DUPLICATE`.

Action: store the raw delivery, skip state changes, write a `DUPLICATE` audit
decision, and mark the delivery as `DONE`.

## Unknown Event Type

Event type is not supported.

Decision: `REJECTED`.

Action: store the raw delivery and write `UNKNOWN_EVENT_TYPE`.

## Event Before Create

An update, payment, cancellation, or refund arrives for an unknown order.

Decision: no final decision until the retry limit is reached.

Action: keep the delivery as `RETRY` with `ORDER_NOT_READY` in its last error
message and retry 10 seconds later. Write final `REJECTED` after attempt `3` if
the order still does not exist.

## Create After Earlier Rejected Event

If an `ORDER_CREATED` event creates the order before a retry becomes available,
the waiting delivery can be processed on its next scheduled attempt.

## Cancelled Order Receives Payment

`PAYMENT_CAPTURED` arrives after cancellation.

Decision: `REJECTED`.

Action: preserve `CANCELLED` state and audit `FORBIDDEN_TRANSITION`.

## Refund Before Payment

`REFUND_ISSUED` arrives before captured payment.

Decision: `REJECTED`.

Action: do not change order state and audit the missing captured payment or
missing order reason.

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

## Updated Status Without Domain Event

`ORDER_UPDATED` contains `status: "PAID"` together with `amount: 199.99`.

Decision: `PARTIALLY_APPLIED` if the amount is applicable; otherwise
`REJECTED`.

Action: apply a current `amountMinor` change but skip `status` with reason
`STATUS_REQUIRES_DOMAIN_EVENT`. A later `PAYMENT_CAPTURED` event is required to
move the order to `PAID` and record `paidAmountMinor`.
