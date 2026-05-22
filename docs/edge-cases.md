# Edge Cases

The engine must make every important decision explicit and auditable.

## Duplicate Event

Same `eventId` appears again.

Decision: `DUPLICATE`.

Action: store the raw delivery, skip state changes, and write an audit decision.

## Unknown Event Type

Event type is not supported.

Decision: `REJECTED`.

Action: store event as invalid and write audit decision.

## Update Before Create

An update arrives for an unknown order.

Decision: `REJECTED`.

Action: do not create an order implicitly from update-like events.

Exception: `ORDER_CREATED` creates the order.

## Cancelled Order Receives Payment

`PAYMENT_CAPTURED` arrives after cancellation.

Decision: `REJECTED`.

Action: preserve `CANCELLED` state and audit forbidden transition.

## Refund Before Payment

`REFUND_ISSUED` arrives before any captured payment.

Decision: `REJECTED`.

Action: refund amount in minor units cannot exceed paid amount in minor units.

## Partial Refund

Refund amount in minor units is lower than paid amount in minor units.

Decision: `ACCEPTED`.

Action: status becomes `PARTIALLY_REFUNDED`.

## Full Refund

Refunded amount in minor units equals paid amount in minor units.

Decision: `ACCEPTED`.

Action: status becomes `REFUNDED`.

## Late Partial Payload

Old event contains a field that has not been updated by newer events.

Decision: `PARTIALLY_APPLIED` or `ACCEPTED`.

Action: apply only non-obsolete fields.

## Conflicting Amount

Two valid events set different amounts in minor units.

Decision: latest field timestamp wins.

Action: skipped fields are written to audit details.
