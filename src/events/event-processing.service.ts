import { Injectable } from '@nestjs/common';
import {
  extractPayloadStatus,
  isOrderStatus,
  optionalString,
  validateIncomingEvent,
} from '../domain/event-utils';
import { hasMoneyValue, toMinorUnits } from '../domain/money';
import { StateMachineService } from '../domain/state-machine.service';
import {
  DeadLetterEventRecord,
  Decision,
  EventDecisionRecord,
  EventEngineDatabase,
  EventType,
  FieldMergeDecision,
  IncomingEvent,
  OrderRecord,
  OrderStatus,
  RawIncomingEventRecord,
  ReasonCode,
} from '../domain/types';
import { JsonDatabaseService } from '../persistence/json-database.service';

interface ProcessOneResult {
  final: boolean;
  stateChanged: boolean;
  decision?: EventDecisionRecord;
}

interface AppliedChangeSet {
  changedFields: Record<string, unknown>;
  skippedFields: Record<string, string>;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus | null;
}

@Injectable()
export class EventProcessingService {
  private readonly maxTechnicalAttempts = 3;
  private readonly retryDelayMs = 500;

  constructor(
    private readonly database: JsonDatabaseService,
    private readonly stateMachine: StateMachineService,
  ) {}

  processAvailable(): void {
    this.database.runInTransaction((database) => {
      let shouldRunAnotherPass = true;
      let passes = 0;

      while (
        shouldRunAnotherPass &&
        passes < database.rawIncomingEvents.length + 2
      ) {
        shouldRunAnotherPass = false;
        passes += 1;

        const now = Date.now();
        const candidates = database.rawIncomingEvents
          .filter((raw) => this.isAvailableForProcessing(raw, now))
          .sort((left, right) => left.id - right.id);

        for (const raw of candidates) {
          const result = this.processOneSafely(database, raw);
          shouldRunAnotherPass = shouldRunAnotherPass || result.stateChanged;
        }
      }
    });
  }

  getResultsForRawIds(rawIds: number[]) {
    return this.database.read((database) =>
      rawIds.map((rawId) => {
        const raw = database.rawIncomingEvents.find(
          (item) => item.id === rawId,
        );
        const decision =
          raw?.lastDecisionId === null
            ? null
            : (database.eventDecisions.find(
                (item) => item.id === raw?.lastDecisionId,
              ) ?? null);

        return {
          incomingEventId: rawId,
          eventId: raw?.eventId ?? null,
          orderId: raw?.orderId ?? null,
          type: raw?.type ?? null,
          status: decision?.decision ?? raw?.processingStatus ?? 'PENDING',
          reasonCode: decision?.reasonCode ?? null,
          reasonMessage: decision?.reasonMessage ?? 'Event is waiting',
          processingTimeMs: decision?.processingTimeMs ?? 0,
        };
      }),
    );
  }

  private isAvailableForProcessing(
    raw: RawIncomingEventRecord,
    now: number,
  ): boolean {
    if (
      raw.processingStatus === 'DONE' ||
      raw.processingStatus === 'DEAD_LETTERED'
    ) {
      return false;
    }

    return new Date(raw.availableAt).getTime() <= now;
  }

  private processOneSafely(
    database: EventEngineDatabase,
    raw: RawIncomingEventRecord,
  ): ProcessOneResult {
    try {
      raw.lastErrorMessage = null;
      return this.processOne(database, raw);
    } catch (error) {
      return this.handleTechnicalFailure(database, raw, error);
    }
  }

  private processOne(
    database: EventEngineDatabase,
    raw: RawIncomingEventRecord,
  ): ProcessOneResult {
    const startedAt = Date.now();
    const validation = validateIncomingEvent(raw.rawEvent);

    if (!validation.ok || !validation.event) {
      return this.finish(
        database,
        raw,
        'REJECTED',
        raw.type && !this.isSupportedType(raw.type)
          ? 'UNKNOWN_EVENT_TYPE'
          : 'INVALID_SCHEMA',
        validation.reasonMessage ?? 'Invalid event schema',
        {},
        startedAt,
        true,
        false,
      );
    }

    const event = validation.event;
    const existingKey = database.processedEventKeys.find(
      (key) => key.eventId === event.eventId,
    );

    if (existingKey && existingKey.firstRawIncomingEventId !== raw.id) {
      return this.finish(
        database,
        raw,
        'DUPLICATE',
        'DUPLICATE_EVENT',
        'Event was already processed or is waiting for processing',
        { firstRawIncomingEventId: existingKey.firstRawIncomingEventId },
        startedAt,
        true,
        false,
        event,
      );
    }

    if (!existingKey) {
      database.processedEventKeys.push({
        eventId: event.eventId,
        firstRawIncomingEventId: raw.id,
        orderId: event.orderId,
        firstSeenAt: new Date().toISOString(),
      });
    }

    const order = this.findOrder(database, event.orderId);
    if (!order && event.type !== 'ORDER_CREATED') {
      return this.deferUntilOrderExists(database, raw, event, startedAt);
    }

    switch (event.type) {
      case 'ORDER_CREATED':
        return this.applyOrderCreated(database, raw, event, startedAt);
      case 'ORDER_UPDATED':
        return this.applyOrderUpdated(database, raw, event, order!, startedAt);
      case 'PAYMENT_CAPTURED':
        return this.applyPaymentCaptured(
          database,
          raw,
          event,
          order!,
          startedAt,
        );
      case 'ORDER_CANCELLED':
        return this.applyOrderCancelled(
          database,
          raw,
          event,
          order!,
          startedAt,
        );
      case 'REFUND_ISSUED':
        return this.applyRefundIssued(database, raw, event, order!, startedAt);
      default: {
        const unsupportedType = (event as { type: string }).type;
        return this.finish(
          database,
          raw,
          'REJECTED',
          'UNKNOWN_EVENT_TYPE',
          `Unsupported event type: ${unsupportedType}`,
          {},
          startedAt,
          true,
          false,
          event,
        );
      }
    }
  }

  private applyOrderCreated(
    database: EventEngineDatabase,
    raw: RawIncomingEventRecord,
    event: IncomingEvent,
    startedAt: number,
  ): ProcessOneResult {
    if (this.findOrder(database, event.orderId)) {
      return this.finish(
        database,
        raw,
        'REJECTED',
        'ORDER_ALREADY_EXISTS',
        'Order already exists',
        {},
        startedAt,
        true,
        false,
        event,
      );
    }

    const requestedStatus = extractPayloadStatus(event.payload);
    if (
      event.payload.status !== undefined &&
      (!requestedStatus || requestedStatus !== 'CREATED')
    ) {
      return this.finish(
        database,
        raw,
        'REJECTED',
        'FORBIDDEN_TRANSITION',
        'ORDER_CREATED can only create an order in CREATED status',
        { requestedStatus: event.payload.status },
        startedAt,
        true,
        false,
        event,
      );
    }

    const amountMinorResult = this.readOptionalMoney(event.payload.amount);
    if (!amountMinorResult.valid) {
      return this.invalidMoney(database, raw, event, startedAt, 'amount');
    }

    const currencyResult = this.readOptionalCurrency(event.payload.currency);
    if (!currencyResult.valid) {
      return this.invalidCurrency(database, raw, event, startedAt);
    }

    const now = new Date().toISOString();
    const order: OrderRecord = {
      orderId: event.orderId,
      status: 'CREATED',
      amountMinor: amountMinorResult.value,
      currency: currencyResult.value,
      paidAmountMinor: 0,
      refundedAmountMinor: 0,
      version: 1,
      maxAcceptedEventTimestamp: event.timestamp,
      lastAcceptedEventId: event.eventId,
      createdAt: now,
      updatedAt: now,
    };

    database.orders.push(order);
    this.rememberFieldVersion(database, event, 'status');
    if (amountMinorResult.value !== null) {
      this.rememberFieldVersion(database, event, 'amountMinor');
    }
    if (currencyResult.value !== null) {
      this.rememberFieldVersion(database, event, 'currency');
    }

    const changedFields: Record<string, unknown> = {
      status: 'CREATED',
      paidAmountMinor: 0,
      refundedAmountMinor: 0,
    };
    if (amountMinorResult.value !== null) {
      changedFields.amountMinor = amountMinorResult.value;
    }
    if (currencyResult.value !== null) {
      changedFields.currency = currencyResult.value;
    }

    this.appendHistory(
      database,
      order,
      event,
      {
        changedFields,
        skippedFields: {},
        fromStatus: null,
        toStatus: 'CREATED',
      },
      'ACCEPTED',
      'APPLIED',
    );

    return this.finish(
      database,
      raw,
      'ACCEPTED',
      'APPLIED',
      'Order created',
      { changedFields },
      startedAt,
      true,
      true,
      event,
    );
  }

  private applyOrderUpdated(
    database: EventEngineDatabase,
    raw: RawIncomingEventRecord,
    event: IncomingEvent,
    order: OrderRecord,
    startedAt: number,
  ): ProcessOneResult {
    const changes: AppliedChangeSet = {
      changedFields: {},
      skippedFields: {},
      fromStatus: null,
      toStatus: null,
    };

    if (hasMoneyValue(event.payload.amount)) {
      const amountMinor = toMinorUnits(event.payload.amount);
      if (amountMinor === null) {
        return this.invalidMoney(database, raw, event, startedAt, 'amount');
      }
      this.applySetField(
        database,
        order,
        event,
        'amountMinor',
        amountMinor,
        changes,
      );
    }

    if (event.payload.currency !== undefined) {
      const currencyResult = this.readOptionalCurrency(event.payload.currency);
      if (!currencyResult.valid || currencyResult.value === null) {
        return this.invalidCurrency(database, raw, event, startedAt);
      }
      this.applySetField(
        database,
        order,
        event,
        'currency',
        currencyResult.value,
        changes,
      );
    }

    if (event.payload.status !== undefined) {
      const requestedStatus = optionalString(event.payload.status);
      if (!requestedStatus || !isOrderStatus(requestedStatus)) {
        return this.finish(
          database,
          raw,
          'REJECTED',
          'INVALID_SCHEMA',
          'payload.status must be a supported order status',
          { status: event.payload.status },
          startedAt,
          true,
          false,
          event,
        );
      }

      const statusResult = this.applyRequestedStatus(
        database,
        order,
        event,
        requestedStatus,
        changes,
      );

      if (!statusResult.ok) {
        return this.finish(
          database,
          raw,
          'REJECTED',
          statusResult.reasonCode,
          statusResult.reasonMessage,
          statusResult.details,
          startedAt,
          true,
          false,
          event,
        );
      }
    }

    return this.finishAppliedChanges(
      database,
      raw,
      event,
      order,
      changes,
      startedAt,
      'Order updated',
    );
  }

  private applyPaymentCaptured(
    database: EventEngineDatabase,
    raw: RawIncomingEventRecord,
    event: IncomingEvent,
    order: OrderRecord,
    startedAt: number,
  ): ProcessOneResult {
    const amountMinor = hasMoneyValue(event.payload.amount)
      ? toMinorUnits(event.payload.amount)
      : order.amountMinor;

    if (amountMinor === null || amountMinor <= 0) {
      return this.finish(
        database,
        raw,
        'REJECTED',
        'PAYMENT_AMOUNT_REQUIRED',
        'PAYMENT_CAPTURED requires a positive amount or an existing order amount',
        { amount: event.payload.amount },
        startedAt,
        true,
        false,
        event,
      );
    }

    if (order.paidAmountMinor > 0) {
      return this.finish(
        database,
        raw,
        'REJECTED',
        'PAYMENT_ALREADY_CAPTURED',
        'Payment was already captured for this order',
        { paidAmountMinor: order.paidAmountMinor },
        startedAt,
        true,
        false,
        event,
      );
    }

    const transition = this.stateMachine.canTransition(order.status, 'PAID');
    if (!transition.allowed) {
      return this.forbiddenTransition(
        database,
        raw,
        event,
        startedAt,
        transition.reason,
      );
    }

    const merge = this.shouldApplySetField(database, event, 'status');
    if (!merge.apply) {
      return this.finish(
        database,
        raw,
        'REJECTED',
        'OBSOLETE_EVENT',
        merge.reason ?? 'Status transition is obsolete',
        { field: 'status' },
        startedAt,
        true,
        false,
        event,
      );
    }

    const changes: AppliedChangeSet = {
      changedFields: { paidAmountMinor: amountMinor },
      skippedFields: {},
      fromStatus: order.status,
      toStatus: 'PAID',
    };

    order.status = 'PAID';
    order.paidAmountMinor = amountMinor;
    this.rememberFieldVersion(database, event, 'status');
    this.rememberFieldVersion(database, event, 'paidAmountMinor');

    return this.finishAppliedChanges(
      database,
      raw,
      event,
      order,
      changes,
      startedAt,
      'Payment captured',
    );
  }

  private applyOrderCancelled(
    database: EventEngineDatabase,
    raw: RawIncomingEventRecord,
    event: IncomingEvent,
    order: OrderRecord,
    startedAt: number,
  ): ProcessOneResult {
    const transition = this.stateMachine.canTransition(
      order.status,
      'CANCELLED',
    );
    if (!transition.allowed) {
      return this.forbiddenTransition(
        database,
        raw,
        event,
        startedAt,
        transition.reason,
      );
    }

    const merge = this.shouldApplySetField(database, event, 'status');
    if (!merge.apply) {
      return this.finish(
        database,
        raw,
        'REJECTED',
        'OBSOLETE_EVENT',
        merge.reason ?? 'Cancellation is obsolete',
        { field: 'status' },
        startedAt,
        true,
        false,
        event,
      );
    }

    const changes: AppliedChangeSet = {
      changedFields: {},
      skippedFields: {},
      fromStatus: order.status,
      toStatus: 'CANCELLED',
    };

    order.status = 'CANCELLED';
    this.rememberFieldVersion(database, event, 'status');

    return this.finishAppliedChanges(
      database,
      raw,
      event,
      order,
      changes,
      startedAt,
      'Order cancelled',
    );
  }

  private applyRefundIssued(
    database: EventEngineDatabase,
    raw: RawIncomingEventRecord,
    event: IncomingEvent,
    order: OrderRecord,
    startedAt: number,
  ): ProcessOneResult {
    const refundAmountValue =
      event.payload.refundAmount ?? event.payload.amount;
    const refundAmountMinor = toMinorUnits(refundAmountValue);

    if (refundAmountMinor === null || refundAmountMinor <= 0) {
      return this.finish(
        database,
        raw,
        'REJECTED',
        'REFUND_AMOUNT_REQUIRED',
        'REFUND_ISSUED requires a positive amount',
        { amount: refundAmountValue },
        startedAt,
        true,
        false,
        event,
      );
    }

    if (!['PAID', 'PARTIALLY_REFUNDED'].includes(order.status)) {
      return this.forbiddenTransition(
        database,
        raw,
        event,
        startedAt,
        `Refund cannot be issued for order in ${order.status} status`,
      );
    }

    const nextRefundedAmount = order.refundedAmountMinor + refundAmountMinor;
    if (
      order.paidAmountMinor <= 0 ||
      nextRefundedAmount > order.paidAmountMinor
    ) {
      return this.finish(
        database,
        raw,
        'REJECTED',
        'REFUND_EXCEEDS_CAPTURED',
        'Refund amount cannot exceed captured payment amount',
        {
          paidAmountMinor: order.paidAmountMinor,
          currentRefundedAmountMinor: order.refundedAmountMinor,
          requestedRefundAmountMinor: refundAmountMinor,
        },
        startedAt,
        true,
        false,
        event,
      );
    }

    const nextStatus: OrderStatus =
      nextRefundedAmount === order.paidAmountMinor
        ? 'REFUNDED'
        : 'PARTIALLY_REFUNDED';

    const transition = this.stateMachine.canTransition(
      order.status,
      nextStatus,
    );
    if (!transition.allowed) {
      return this.forbiddenTransition(
        database,
        raw,
        event,
        startedAt,
        transition.reason,
      );
    }

    const changes: AppliedChangeSet = {
      changedFields: {
        refundedAmountMinor: nextRefundedAmount,
      },
      skippedFields: {},
      fromStatus: order.status === nextStatus ? null : order.status,
      toStatus: order.status === nextStatus ? null : nextStatus,
    };

    order.refundedAmountMinor = nextRefundedAmount;
    order.status = nextStatus;
    this.rememberLatestFieldEvent(database, event, 'status');
    this.rememberLatestFieldEvent(database, event, 'refundedAmountMinor');

    return this.finishAppliedChanges(
      database,
      raw,
      event,
      order,
      changes,
      startedAt,
      'Refund issued',
    );
  }

  private applyRequestedStatus(
    database: EventEngineDatabase,
    order: OrderRecord,
    event: IncomingEvent,
    requestedStatus: OrderStatus,
    changes: AppliedChangeSet,
  ):
    | { ok: true }
    | {
        ok: false;
        reasonCode: ReasonCode;
        reasonMessage: string;
        details: Record<string, unknown>;
      } {
    if (requestedStatus === order.status) {
      return { ok: true };
    }

    const merge = this.shouldApplySetField(database, event, 'status');
    if (!merge.apply) {
      changes.skippedFields.status = merge.reason ?? 'Status field is obsolete';
      return { ok: true };
    }

    const transition = this.stateMachine.canTransition(
      order.status,
      requestedStatus,
    );
    if (!transition.allowed) {
      return {
        ok: false,
        reasonCode: 'FORBIDDEN_TRANSITION',
        reasonMessage: transition.reason,
        details: { fromStatus: order.status, toStatus: requestedStatus },
      };
    }

    if (requestedStatus === 'PAID') {
      const paidAmountMinor = hasMoneyValue(event.payload.amount)
        ? toMinorUnits(event.payload.amount)
        : order.amountMinor;

      if (paidAmountMinor === null || paidAmountMinor <= 0) {
        return {
          ok: false,
          reasonCode: 'PAYMENT_AMOUNT_REQUIRED',
          reasonMessage:
            'Changing status to PAID requires a positive amount or an existing order amount',
          details: { amount: event.payload.amount },
        };
      }
      order.paidAmountMinor = paidAmountMinor;
      changes.changedFields.paidAmountMinor = paidAmountMinor;
      this.rememberFieldVersion(database, event, 'paidAmountMinor');
    }

    if (requestedStatus === 'REFUNDED') {
      if (order.paidAmountMinor <= 0) {
        return {
          ok: false,
          reasonCode: 'REFUND_EXCEEDS_CAPTURED',
          reasonMessage: 'Cannot refund an order without captured payment',
          details: { paidAmountMinor: order.paidAmountMinor },
        };
      }
      order.refundedAmountMinor = order.paidAmountMinor;
      changes.changedFields.refundedAmountMinor = order.refundedAmountMinor;
      this.rememberFieldVersion(database, event, 'refundedAmountMinor');
    }

    if (requestedStatus === 'PARTIALLY_REFUNDED') {
      return {
        ok: false,
        reasonCode: 'FORBIDDEN_TRANSITION',
        reasonMessage:
          'Use REFUND_ISSUED with an amount to create a partial refund',
        details: { requestedStatus },
      };
    }

    changes.fromStatus = order.status;
    changes.toStatus = requestedStatus;
    order.status = requestedStatus;
    this.rememberFieldVersion(database, event, 'status');
    return { ok: true };
  }

  private finishAppliedChanges(
    database: EventEngineDatabase,
    raw: RawIncomingEventRecord,
    event: IncomingEvent,
    order: OrderRecord,
    changes: AppliedChangeSet,
    startedAt: number,
    successMessage: string,
  ): ProcessOneResult {
    const changedFieldCount =
      Object.keys(changes.changedFields).length +
      (changes.toStatus !== null ? 1 : 0);
    const skippedFieldCount = Object.keys(changes.skippedFields).length;

    if (changedFieldCount === 0) {
      const reasonCode: ReasonCode =
        skippedFieldCount > 0 ? 'OBSOLETE_EVENT' : 'NO_APPLICABLE_CHANGES';
      return this.finish(
        database,
        raw,
        'REJECTED',
        reasonCode,
        skippedFieldCount > 0
          ? 'All provided fields are obsolete'
          : 'Event did not contain any applicable changes',
        { skippedFields: changes.skippedFields },
        startedAt,
        true,
        false,
        event,
      );
    }

    const decision: Extract<Decision, 'ACCEPTED' | 'PARTIALLY_APPLIED'> =
      skippedFieldCount > 0 ? 'PARTIALLY_APPLIED' : 'ACCEPTED';
    const reasonCode: ReasonCode =
      decision === 'PARTIALLY_APPLIED' ? 'PARTIAL_MERGE' : 'APPLIED';

    this.touchOrder(order, event);
    this.appendHistory(database, order, event, changes, decision, reasonCode);

    return this.finish(
      database,
      raw,
      decision,
      reasonCode,
      decision === 'PARTIALLY_APPLIED'
        ? 'Event was partially applied'
        : successMessage,
      {
        changedFields: changes.changedFields,
        skippedFields: changes.skippedFields,
        fromStatus: changes.fromStatus,
        toStatus: changes.toStatus,
      },
      startedAt,
      true,
      true,
      event,
    );
  }

  private applySetField(
    database: EventEngineDatabase,
    order: OrderRecord,
    event: IncomingEvent,
    fieldName: 'amountMinor' | 'currency',
    value: number | string,
    changes: AppliedChangeSet,
  ): void {
    const merge = this.shouldApplySetField(database, event, fieldName);
    if (!merge.apply) {
      changes.skippedFields[fieldName] =
        merge.reason ?? `${fieldName} is obsolete`;
      return;
    }

    if (order[fieldName] !== value) {
      order[fieldName] = value as never;
      changes.changedFields[fieldName] = value;
    }
    this.rememberFieldVersion(database, event, fieldName);
  }

  private shouldApplySetField(
    database: EventEngineDatabase,
    event: IncomingEvent,
    fieldName: string,
  ): FieldMergeDecision {
    const version = database.orderFieldVersions.find(
      (item) => item.orderId === event.orderId && item.fieldName === fieldName,
    );

    if (!version || event.timestamp > version.lastEventTimestamp) {
      return { apply: true };
    }

    if (event.timestamp === version.lastEventTimestamp) {
      return {
        apply: false,
        reason: `${fieldName} already has a value from timestamp ${event.timestamp}`,
      };
    }

    return {
      apply: false,
      reason: `${fieldName} is older than the accepted field version`,
    };
  }

  private rememberFieldVersion(
    database: EventEngineDatabase,
    event: IncomingEvent,
    fieldName: string,
  ): void {
    const existing = database.orderFieldVersions.find(
      (item) => item.orderId === event.orderId && item.fieldName === fieldName,
    );
    const now = new Date().toISOString();

    if (existing) {
      existing.lastEventTimestamp = event.timestamp;
      existing.lastEventId = event.eventId;
      existing.updatedAt = now;
      return;
    }

    database.orderFieldVersions.push({
      orderId: event.orderId,
      fieldName,
      lastEventTimestamp: event.timestamp,
      lastEventId: event.eventId,
      updatedAt: now,
    });
  }

  private rememberLatestFieldEvent(
    database: EventEngineDatabase,
    event: IncomingEvent,
    fieldName: string,
  ): void {
    const existing = database.orderFieldVersions.find(
      (item) => item.orderId === event.orderId && item.fieldName === fieldName,
    );

    if (!existing || event.timestamp > existing.lastEventTimestamp) {
      this.rememberFieldVersion(database, event, fieldName);
    }
  }

  private appendHistory(
    database: EventEngineDatabase,
    order: OrderRecord,
    event: IncomingEvent,
    changes: AppliedChangeSet,
    decision: Extract<Decision, 'ACCEPTED' | 'PARTIALLY_APPLIED'>,
    reasonCode: ReasonCode,
  ): void {
    const now = new Date().toISOString();
    database.orderHistory.push({
      id: database.nextIds.orderHistory++,
      orderId: order.orderId,
      eventId: event.eventId,
      eventType: event.type,
      eventTimestamp: event.timestamp,
      processedAt: now,
      fromStatus: changes.fromStatus,
      toStatus: changes.toStatus,
      changedFields: changes.changedFields,
      skippedFields: changes.skippedFields,
      decision,
      reasonCode,
      createdAt: now,
    });
  }

  private finish(
    database: EventEngineDatabase,
    raw: RawIncomingEventRecord,
    decision: Decision,
    reasonCode: ReasonCode,
    reasonMessage: string,
    details: Record<string, unknown>,
    startedAt: number,
    final: boolean,
    stateChanged: boolean,
    event?: IncomingEvent,
  ): ProcessOneResult {
    const now = new Date().toISOString();
    const processingTimeMs = Date.now() - startedAt;
    const decisionRecord: EventDecisionRecord = {
      id: database.nextIds.eventDecision++,
      rawIncomingEventId: raw.id,
      eventId: event?.eventId ?? raw.eventId,
      orderId: event?.orderId ?? raw.orderId,
      type: event?.type ?? raw.type,
      timestamp: event?.timestamp ?? raw.eventTimestamp,
      decision,
      reasonCode,
      reasonMessage,
      details,
      processingTimeMs,
      createdAt: now,
    };

    database.eventDecisions.push(decisionRecord);
    raw.processingStatus = final ? 'DONE' : 'DEFERRED';
    raw.lastDecisionId = decisionRecord.id;
    raw.lastReasonCode = reasonCode;

    if (final) {
      this.updateStats(database, decision, processingTimeMs);
    }

    return { final, stateChanged, decision: decisionRecord };
  }

  private deferUntilOrderExists(
    database: EventEngineDatabase,
    raw: RawIncomingEventRecord,
    event: IncomingEvent,
    startedAt: number,
  ): ProcessOneResult {
    if (
      raw.processingStatus === 'DEFERRED' &&
      raw.lastReasonCode === 'ORDER_NOT_READY' &&
      raw.lastDecisionId !== null
    ) {
      const decision = database.eventDecisions.find(
        (item) => item.id === raw.lastDecisionId,
      );
      if (decision) {
        return { final: false, stateChanged: false, decision };
      }
    }

    return this.finish(
      database,
      raw,
      'DEFERRED',
      'ORDER_NOT_READY',
      'Order does not exist yet; event will be retried after future ingestions',
      {},
      startedAt,
      false,
      false,
      event,
    );
  }

  private forbiddenTransition(
    database: EventEngineDatabase,
    raw: RawIncomingEventRecord,
    event: IncomingEvent,
    startedAt: number,
    reason: string,
  ): ProcessOneResult {
    return this.finish(
      database,
      raw,
      'REJECTED',
      'FORBIDDEN_TRANSITION',
      reason,
      {},
      startedAt,
      true,
      false,
      event,
    );
  }

  private invalidMoney(
    database: EventEngineDatabase,
    raw: RawIncomingEventRecord,
    event: IncomingEvent,
    startedAt: number,
    fieldName: string,
  ): ProcessOneResult {
    return this.finish(
      database,
      raw,
      'REJECTED',
      'INVALID_SCHEMA',
      `${fieldName} must be a non-negative decimal amount with at most two fractional digits`,
      { fieldName, value: event.payload[fieldName] },
      startedAt,
      true,
      false,
      event,
    );
  }

  private invalidCurrency(
    database: EventEngineDatabase,
    raw: RawIncomingEventRecord,
    event: IncomingEvent,
    startedAt: number,
  ): ProcessOneResult {
    return this.finish(
      database,
      raw,
      'REJECTED',
      'INVALID_SCHEMA',
      'currency must be a three-letter uppercase code',
      { currency: event.payload.currency },
      startedAt,
      true,
      false,
      event,
    );
  }

  private readOptionalMoney(value: unknown): {
    valid: boolean;
    value: number | null;
  } {
    if (!hasMoneyValue(value)) {
      return { valid: true, value: null };
    }

    const amountMinor = toMinorUnits(value);
    return { valid: amountMinor !== null, value: amountMinor };
  }

  private readOptionalCurrency(value: unknown): {
    valid: boolean;
    value: string | null;
  } {
    if (value === undefined || value === null) {
      return { valid: true, value: null };
    }

    const currency = optionalString(value);
    return {
      valid: currency !== null && /^[A-Z]{3}$/.test(currency),
      value: currency,
    };
  }

  private touchOrder(order: OrderRecord, event: IncomingEvent): void {
    order.version += 1;
    order.maxAcceptedEventTimestamp = Math.max(
      order.maxAcceptedEventTimestamp,
      event.timestamp,
    );
    order.lastAcceptedEventId = event.eventId;
    order.updatedAt = new Date().toISOString();
  }

  private findOrder(database: EventEngineDatabase, orderId: string) {
    return database.orders.find((order) => order.orderId === orderId) ?? null;
  }

  private updateStats(
    database: EventEngineDatabase,
    decision: Decision,
    processingTimeMs: number,
  ): void {
    if (decision === 'ACCEPTED') {
      database.stats.acceptedEventsCount += 1;
      database.stats.validEventsCount += 1;
    }
    if (decision === 'PARTIALLY_APPLIED') {
      database.stats.partiallyAppliedEventsCount += 1;
      database.stats.validEventsCount += 1;
    }
    if (decision === 'REJECTED' || decision === 'FAILED') {
      database.stats.rejectedEventsCount += 1;
    }
    if (decision === 'DUPLICATE') {
      database.stats.duplicateEventsCount += 1;
    }

    database.stats.processedEventsCount += 1;
    database.stats.totalProcessingTimeMs += processingTimeMs;
    database.stats.updatedAt = new Date().toISOString();
  }

  private isSupportedType(type: string): type is EventType {
    return [
      'ORDER_CREATED',
      'ORDER_UPDATED',
      'PAYMENT_CAPTURED',
      'ORDER_CANCELLED',
      'REFUND_ISSUED',
    ].includes(type);
  }

  private handleTechnicalFailure(
    database: EventEngineDatabase,
    raw: RawIncomingEventRecord,
    error: unknown,
  ): ProcessOneResult {
    const errorMessage = error instanceof Error ? error.message : String(error);
    raw.attempts += 1;
    raw.lastErrorMessage = errorMessage;

    if (raw.attempts < this.maxTechnicalAttempts) {
      raw.processingStatus = 'PENDING';
      raw.availableAt = new Date(
        Date.now() + raw.attempts * this.retryDelayMs,
      ).toISOString();
      return { final: false, stateChanged: false };
    }

    const now = new Date().toISOString();
    raw.processingStatus = 'DEAD_LETTERED';
    raw.availableAt = now;

    const decisionRecord: EventDecisionRecord = {
      id: database.nextIds.eventDecision++,
      rawIncomingEventId: raw.id,
      eventId: raw.eventId,
      orderId: raw.orderId,
      type: raw.type,
      timestamp: raw.eventTimestamp,
      decision: 'FAILED',
      reasonCode: 'PROCESSING_ERROR',
      reasonMessage: 'Technical processing failed and was moved to DLQ',
      details: { errorMessage, attempts: raw.attempts },
      processingTimeMs: 0,
      createdAt: now,
    };

    const deadLetterEvent: DeadLetterEventRecord = {
      id: database.nextIds.deadLetterEvent++,
      rawIncomingEventId: raw.id,
      eventId: raw.eventId,
      orderId: raw.orderId,
      type: raw.type,
      timestamp: raw.eventTimestamp,
      rawEvent: raw.rawEvent,
      reasonCode: 'PROCESSING_ERROR',
      errorMessage,
      attempts: raw.attempts,
      createdAt: now,
    };

    database.eventDecisions.push(decisionRecord);
    database.deadLetterEvents.push(deadLetterEvent);
    raw.lastDecisionId = decisionRecord.id;
    raw.lastReasonCode = 'PROCESSING_ERROR';
    this.updateStats(database, 'FAILED', 0);

    return { final: true, stateChanged: false, decision: decisionRecord };
  }
}
