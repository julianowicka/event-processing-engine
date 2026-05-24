import type { JsonObject, JsonValue } from './json.types';

export function parseJsonValue(json: string): JsonValue {
  return JSON.parse(json) as JsonValue;
}

export function parseJsonObject(json: string): JsonObject {
  const value = parseJsonValue(json);

  return isJsonObject(value) ? value : {};
}

export function isJsonObject(
  value: JsonValue | undefined,
): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
