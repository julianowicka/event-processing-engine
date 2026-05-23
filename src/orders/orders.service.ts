import { Injectable, NotFoundException } from '@nestjs/common';
import { JsonDatabaseService } from '../persistence/json-database.service';

@Injectable()
export class OrdersService {
  constructor(private readonly database: JsonDatabaseService) {}

  getOrder(orderId: string) {
    return this.database.read((database) => {
      const order =
        database.orders.find((item) => item.orderId === orderId) ?? null;
      const history = database.orderHistory
        .filter((item) => item.orderId === orderId)
        .sort((left, right) => left.id - right.id)
        .map((item) => ({
          eventId: item.eventId,
          eventType: item.eventType,
          eventTimestamp: item.eventTimestamp,
          processedAt: item.processedAt,
          fromStatus: item.fromStatus,
          toStatus: item.toStatus,
          changedFields: item.changedFields,
          skippedFields: item.skippedFields,
          decision: item.decision,
          reasonCode: item.reasonCode,
        }));
      const auditLog = database.eventDecisions
        .filter((item) => item.orderId === orderId)
        .sort((left, right) => left.id - right.id)
        .map((item) => ({
          eventId: item.eventId,
          type: item.type,
          timestamp: item.timestamp,
          decision: item.decision,
          reasonCode: item.reasonCode,
          reasonMessage: item.reasonMessage,
          details: item.details,
          processingTimeMs: item.processingTimeMs,
          createdAt: item.createdAt,
        }));

      if (!order && history.length === 0 && auditLog.length === 0) {
        throw new NotFoundException(`Order ${orderId} was not found`);
      }

      return {
        currentState: order
          ? {
              orderId: order.orderId,
              status: order.status,
              amountMinor: order.amountMinor,
              currency: order.currency,
              paidAmountMinor: order.paidAmountMinor,
              refundedAmountMinor: order.refundedAmountMinor,
              version: order.version,
              maxAcceptedEventTimestamp: order.maxAcceptedEventTimestamp,
              lastAcceptedEventId: order.lastAcceptedEventId,
              updatedAt: order.updatedAt,
            }
          : null,
        history,
        rejectedEvents: auditLog.filter((item) =>
          ['REJECTED', 'DUPLICATE', 'FAILED'].includes(item.decision),
        ),
        pendingEvents: auditLog.filter((item) => item.decision === 'DEFERRED'),
        auditLog,
      };
    });
  }
}
