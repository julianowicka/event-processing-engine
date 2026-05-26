import type { JsonObject, JsonValue } from './json.types';

const minorMoneyFieldResponseNames: Record<string, string> = {
  amountMinor: 'amount',
  paidAmountMinor: 'paidAmount',
  refundedAmountMinor: 'refundedAmount',
};

export function minorUnitsToAmount(value: number): number {
  return value / 100;
}

export function mapMoneyFieldsForResponse(fields: JsonObject): JsonObject {
  const mappedFields: JsonObject = {};

  for (const [fieldName, value] of Object.entries(fields)) {
    const responseFieldName = minorMoneyFieldResponseNames[fieldName];

    if (responseFieldName) {
      mappedFields[responseFieldName] = mapMoneyFieldValue(value);
      continue;
    }

    mappedFields[fieldName] = value;
  }

  return mappedFields;
}

function mapMoneyFieldValue(
  value: JsonValue | undefined,
): JsonValue | undefined {
  return typeof value === 'number' ? minorUnitsToAmount(value) : value;
}
