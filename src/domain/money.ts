export function toMinorUnits(value: unknown): number | null {
  const amount =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }

  const minor = Math.round(amount * 100);
  return Math.abs(amount * 100 - minor) < 0.000001 ? minor : null;
}

export function hasMoneyValue(value: unknown): boolean {
  return value !== undefined && value !== null;
}
